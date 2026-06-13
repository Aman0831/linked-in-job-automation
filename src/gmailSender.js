/**
 * src/gmailSender.js
 * ───────────────────
 * Sends application emails following the C2C API email format.
 * - Role-based resume selection (Aman=Java, Karan=BA, Sunny=PM, Snehal=DA)
 * - AI-tailored professional summary injected into each resume
 * - Email format: To / CC / BCC / Subject / Body as per PDF spec
 */

const nodemailer = require('nodemailer');
const path       = require('path');
const fs         = require('fs');
const logger     = require('./logger');

const CC_EMAIL  = process.env.CC_EMAIL  || null;
const BCC_EMAIL = process.env.BCC_EMAIL || null;
const TEAM_LEAD = process.env.TEAM_LEAD_EMAIL || null;

// ── Candidate built from .env — change .env, no code changes needed ───────
function getCandidateFromEnv() {
  return {
    name:       process.env.CANDIDATE_NAME     || 'Candidate',
    email:      process.env.CANDIDATE_EMAIL    || process.env.GMAIL_EMAIL,
    phone:      process.env.CANDIDATE_PHONE    || '',
    linkedin:   process.env.CANDIDATE_LINKEDIN || '',
    location:   process.env.CANDIDATE_LOCATION || '',
    visa:       process.env.CANDIDATE_VISA     || '',
    experience: process.env.CANDIDATE_EXPERIENCE || '',
    salary:     process.env.CANDIDATE_SALARY   || 'Open / As per market rate',
    resume:     path.resolve(`./assets/${process.env.CANDIDATE_RESUME || 'resume.pdf'}`),
  };
}

// Single candidate for all roles — pulled fresh from .env on each run
function getRoleCandidate() {
  const candidate = getCandidateFromEnv();
  const roles = [];
  let i = 1;
  while (process.env[`SEARCH_KEYWORD_${i}`]) {
    roles.push(process.env[`SEARCH_KEYWORD_${i}`].trim().toUpperCase());
    i++;
  }
  const map = { 'GENERAL': candidate };
  roles.forEach(r => { map[r] = candidate; });
  return map;
}

function createTransporter() {
  if (process.env.GMAIL_REFRESH_TOKEN) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2', user: process.env.GMAIL_EMAIL,
        clientId: process.env.GMAIL_CLIENT_ID,
        clientSecret: process.env.GMAIL_CLIENT_SECRET,
        refreshToken: process.env.GMAIL_REFRESH_TOKEN,
      },
    });
  }
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_EMAIL, pass: process.env.GMAIL_APP_PASSWORD },
    connectionTimeout: 30000,
    greetingTimeout:   20000,
    socketTimeout:     30000,
  });
}

// ── AI: Tailor resume bullet points ──────────────────────────────────────
async function tailorResumePoints(jobDescription, searchRole) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `You are a resume writer. Based on this job description, write 5 tailored resume bullet points for a candidate applying for a ${searchRole} (C2C contract) role. Make them specific to the keywords and requirements in the job description. Return ONLY the 5 bullet points, one per line, starting with •\n\nJob Description:\n${jobDescription.slice(0, 2000)}`
        }]
      })
    });
    const data = await response.json();
    return data.content?.[0]?.text?.trim() || getDefaultBullets(searchRole);
  } catch (e) {
    logger.warn(`AI bullet tailoring failed: ${e.message}`);
    return getDefaultBullets(searchRole);
  }
}

// ── AI: Tailor professional summary for resume PDF ────────────────────────
async function tailorProfessionalSummary(jobDescription, candidate, searchRole) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Write a 3-sentence professional summary for ${candidate.name}, a ${searchRole} with ${candidate.experience} of experience applying for a C2C contract role. Tailor it to match the keywords and requirements in this job description. Keep it concise, professional, and in third person. Return ONLY the summary text, no labels or headings.\n\nJob Description:\n${jobDescription.slice(0, 1500)}`
        }]
      })
    });
    const data = await response.json();
    return data.content?.[0]?.text?.trim() || null;
  } catch (e) {
    logger.warn(`AI summary tailoring failed: ${e.message}`);
    return null;
  }
}

// ── AI: Extract missing skills from job description ───────────────────────
async function extractMissingSkills(jobDescription, candidateName) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Extract ONLY the specific technical skills, tools, and platforms mentioned in this job description that a ${process.env.CANDIDATE_ROLE || 'software professional'} might need. Return ONLY a comma-separated list of skills (max 8), no explanations. Focus on tools, software, platforms, and technical skills. If no specific skills are mentioned return empty string.\n\nJob Description:\n${jobDescription.slice(0, 2000)}`
        }]
      })
    });
    const data = await response.json();
    return data.content?.[0]?.text?.trim() || '';
  } catch(e) {
    logger.warn(`AI skill extraction failed: ${e.message}`);
    return '';
  }
}

// ── Build tailored resume PDF using Python script ─────────────────────────
async function buildTailoredResumeAttachment(job, candidate, tailoredSummary) {
  const resumePath = candidate.resume;

  if (!fs.existsSync(resumePath)) {
    logger.warn(`Resume missing for ${candidate.name}: ${resumePath} — skipping`);
    return [];
  }

  // Extract missing skills from job description
  logger.info(`🔍 Extracting missing skills from job description...`);
  const newSkills = await extractMissingSkills(job.fullDescription, candidate.name);
  if (newSkills) logger.info(`   New skills to add: ${newSkills}`);

  // Fallback summary if AI returns null
  const domain    = process.env.CANDIDATE_DOMAIN      || 'software development';
  const skills    = process.env.CANDIDATE_SKILLS_FOCUS || 'programming and problem solving';
  const workAuth  = process.env.CANDIDATE_WORK_AUTH    || 'available immediately';
  const isFresher = !candidate.experience || candidate.experience.toLowerCase() === 'fresher';
  const experiencePart = isFresher ? '' : `with ${candidate.experience} years of experience `;
  const summaryToUse = tailoredSummary ||
    `${candidate.name} is a results-driven ${domain} professional ${experiencePart}skilled in ${skills}. ${workAuth}.`;

  logger.info(`📝 Summary: ${summaryToUse.slice(0, 80)}...`);

  // Build tailored resume path
  const baseName    = path.basename(resumePath, '.pdf');
  const tailoredPath = path.resolve(`./assets/${baseName}_Tailored.pdf`);

  // Call Python script to rebuild resume with new summary + skills
  try {
    const { spawnSync } = require('child_process');
    const scriptPath = path.resolve('./updateResume.py');

    if (!fs.existsSync(scriptPath)) {
      logger.warn(`updateResume.py not found at ${scriptPath} — attaching original resume`);
      return [{ filename: `${candidate.name.replace(/ /g,'_')}_Resume.pdf`, path: resumePath }];
    }

    const result = spawnSync('python3', [
      scriptPath,
      '--input',   resumePath,
      '--output',  tailoredPath,
      '--summary', summaryToUse,
      '--skills',  newSkills || '',
    ], { timeout: 30000, encoding: 'utf8' });

    if (result.status !== 0) {
      logger.warn(`Resume rebuild error: ${result.stderr} — attaching original`);
      return [{ filename: `${candidate.name.replace(/ /g,'_')}_Resume.pdf`, path: resumePath }];
    }

    logger.info(`📄 Tailored resume built: ${path.basename(tailoredPath)}`);
    return [{ filename: `${candidate.name.replace(/ /g,'_')}_Resume.pdf`, path: tailoredPath }];

  } catch(e) {
    logger.warn(`Resume rebuild failed: ${e.message} — attaching original`);
    return [{ filename: `${candidate.name.replace(/ /g,'_')}_Resume.pdf`, path: resumePath }];
  }
}

function getDefaultBullets(role) {
  const bullets = {
    'JAVA DEVELOPER + C2C': `• 8+ years of Java development with Spring Boot and Microservices architecture
• Designed RESTful APIs handling 10M+ daily transactions with 99.99% uptime
• Proficient in Hibernate/JPA, SQL/NoSQL databases, Docker, and Kubernetes
• CI/CD pipelines using Jenkins, GitHub Actions, and AWS deployments
• Strong Agile/Scrum background with cross-functional team collaboration`,
    'BUSINESS ANALYST + C2C': `• 7+ years as Business Analyst bridging technical and business requirements
• Expert in requirements gathering, user story writing, and process documentation
• Proficient in JIRA, Confluence, Visio, SQL, and Tableau
• Led UAT sessions and coordinated with dev teams for on-time delivery
• Strong Agile/Scrum methodology and sprint planning experience`,
    'PROJECT MANAGER + C2C': `• 9+ years managing IT projects using Agile and Waterfall methodologies
• Managed budgets up to $8M and cross-functional teams of 25+ members
• PMP certified with expertise in risk management and stakeholder communication
• Proficient in MS Project, JIRA, Confluence, and resource planning tools
• Track record of delivering projects on time and within scope`,
    'DATA ANALYST + C2C': `• 6+ years of data analysis using Python, SQL, and Power BI / Tableau
• Built dashboards reducing reporting time by 40% for business teams
• Experience with ETL pipelines, data warehousing, AWS Redshift
• Predictive modeling with scikit-learn — 89% accuracy churn model
• Translates complex data into actionable insights for stakeholders`,
  };
  return bullets[role] || bullets['JAVA DEVELOPER + C2C'];
}

function formatDate(postedDate, postedAt) {
  if (postedDate) {
    try {
      return new Date(postedDate).toLocaleString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch(_) {}
  }
  return postedAt || 'Recently';
}

// ── Extract key details from post ─────────────────────────────────────────
function extractKeyDetails(description) {
  const text = description || '';
  const locationMatch = text.match(/(?:location|loc)[:\s]+([^\n,]{5,50})/i) ||
                        text.match(/\b(remote|onsite|hybrid|new york|new jersey|texas|california|chicago|dallas|seattle|austin|atlanta)\b/i);
  const rateMatch     = text.match(/\$[\d,]+(?:\/hr|\/hour|k|K)?(?:\s*[-–]\s*\$[\d,]+(?:\/hr|\/hour|k|K)?)?/i);
  const durationMatch = text.match(/(\d+\s*(?:months?|years?|weeks?)\s*(?:contract|engagement)?)/i);
  const INVALID_LOCATIONS = ['remote', 'on-site', 'onsite', 'hybrid', 'on site'];
  const rawLocation = locationMatch ? locationMatch[1].trim() : null;
  const location = rawLocation && !INVALID_LOCATIONS.includes(rawLocation.toLowerCase().replace(/·\s*/,'').trim())
    ? rawLocation.replace(/·\s*/,'').trim()
    : null;
  return {
    location,
    rate:     rateMatch     ? rateMatch[0].trim()     : null,
    duration: durationMatch ? durationMatch[1].trim() : null,
  };
}

// ── Compose email per PDF format spec ─────────────────────────────────────
async function composeEmail(job, tailoredSummary, candidate) {
  const date    = formatDate(job.postedDate, job.postedAt);
  const details = extractKeyDetails(job.fullDescription);

  // Subject: Submission "SkillSet" Local to "Location"
  // Use CANDIDATE_ROLE from .env if set, otherwise use detected role
  const skillSet = process.env.CANDIDATE_ROLE || job.searchRole;
  const location = details.location || candidate.location;
  const subject  = `Submission "${skillSet}" Local to "${location}"`;

  // ── Plain text (exact format from PDF) ───────────────────────────────────
  const text =
`Hi,

Hope you are doing well,

Kindly find attached resume and below details:

Full Name         : ${candidate.name}
Email Address     : ${candidate.email}
Phone             : ${candidate.phone}
LinkedIn          : ${candidate.linkedin}
Current Location  : ${candidate.location}
Open to Relocate  : Yes
Work Authorization: ${candidate.visa}
Availability      : Immediate
Total Experience  : ${candidate.experience}
Salary            : ${details.rate || 'Open / As per market rate'}

Regards
${candidate.name}
${TEAM_LEAD}

────────────────────────────────────
JOB DESCRIPTION (as per LinkedIn post)
────────────────────────────────────
Position   : ${job.jobTitle}
Posted by  : ${job.posterName}${job.posterTitle ? ' — ' + job.posterTitle : ''}
Posted on  : ${date}
Post link  : ${job.postUrl || 'N/A'}
${details.location ? `Location   : ${details.location}` : ''}
${details.rate     ? `Rate       : ${details.rate}`     : ''}
${details.duration ? `Duration   : ${details.duration}` : ''}
────────────────────────────────────

`;

  // ── HTML ──────────────────────────────────────────────────────────────────
  const detailRows = [
    ['Full Name',          candidate.name],
    ['Email Address',      candidate.email],
    ['Phone',              candidate.phone],
    ['LinkedIn',           candidate.linkedin],
    ['Current Location',   candidate.location],
    ['Open to Relocate',   'Yes'],
    ['Work Authorization', candidate.visa],
    ['Availability',       'Immediate'],
    ['Total Experience',   candidate.experience],
    ['Salary',             candidate.salary || details.rate || 'Open / As per market rate'],
  ];

  const candidateRowsHtml = detailRows.map(([label, value]) =>
    `<tr>
      <td style="padding:4px 8px;font-weight:bold;color:#444;width:160px;border-bottom:1px solid #eee;">${escHtml(label)}:</td>
      <td style="padding:4px 8px;color:#222;border-bottom:1px solid #eee;">${escHtml(value)}</td>
    </tr>`
  ).join('\n');

  const jdRows = [
    ['Position',  job.jobTitle],
    ['Posted by', `${job.posterName}${job.posterTitle ? ' — ' + job.posterTitle : ''}`],
    ['Posted on', date],
    ['Post link', job.postUrl || 'N/A'],
    ...(details.location ? [['Location', details.location]] : []),
    ...(details.rate     ? [['Rate',     details.rate]]     : []),
    ...(details.duration ? [['Duration', details.duration]] : []),
  ].map(([label, value]) => {
    const val = label === 'Post link' && job.postUrl
      ? `<a href="${escHtml(job.postUrl)}" target="_blank" style="color:#0a66c2;">View on LinkedIn →</a>`
      : escHtml(value);
    return `<tr>
      <td style="padding:4px 8px;font-weight:bold;color:#444;width:100px;border-bottom:1px solid #eee;">${escHtml(label)}:</td>
      <td style="padding:4px 8px;color:#222;border-bottom:1px solid #eee;">${val}</td>
    </tr>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:700px;">

<p>Hi,</p>

<p>Hope you are doing well,</p>

<p>Kindly find attached resume and below details:</p>

<!-- Candidate Details -->
<div style="background:#f4f7fb;border-left:4px solid #0a66c2;padding:16px 20px;margin:18px 0;border-radius:4px;">
  <div style="font-size:13px;text-transform:uppercase;color:#0a66c2;font-weight:bold;margin-bottom:10px;">
    👤 Candidate Details
  </div>
  <table style="border-collapse:collapse;width:100%;">
    ${candidateRowsHtml}
  </table>
</div>


<p>Regards,<br/>
<strong>${escHtml(candidate.name)}</strong><br/>
<a href="mailto:${escHtml(TEAM_LEAD)}" style="color:#0a66c2;">${escHtml(TEAM_LEAD)}</a>
</p>

<hr style="border:none;border-top:1px solid #ddd;margin:20px 0"/>

<!-- Job Description -->
<div style="background:#fafafa;border-left:4px solid #888;padding:16px 20px;margin:18px 0;border-radius:4px;">
  <div style="font-size:13px;text-transform:uppercase;color:#555;font-weight:bold;margin-bottom:10px;">
    📋 Job Description (as per LinkedIn post)
  </div>
  <table style="border-collapse:collapse;width:100%;">
    ${jdRows}
  </table>
</div>

<p style="font-size:11px;color:#999;">
  BCC: ${escHtml(BCC_EMAIL)}
</p>

</body>
</html>`;

  return { subject, html, text };
}

// ── Main send function ────────────────────────────────────────────────────
async function sendApplicationEmails(jobPosts, onSent) {
  const transporter = createTransporter();
  const results     = [];

  // Verify with retry
  let verified = false;
  for (let i = 1; i <= 3; i++) {
    try {
      await transporter.verify();
      logger.info('✅ Gmail SMTP connection verified.');
      verified = true;
      break;
    } catch(err) {
      logger.warn(`Gmail verify attempt ${i} failed: ${err.message}`);
      if (i < 3) await new Promise(r => setTimeout(r, 3000));
    }
  }
  if (!verified) throw new Error('Gmail authentication failed after 3 attempts.');

  const ROLE_CANDIDATE = getRoleCandidate();
  const withEmail = jobPosts.filter(j => j.recruiterEmail);
  logger.info(`${withEmail.length} of ${jobPosts.length} post(s) have recruiter emails.`);

  for (const job of withEmail) {
    const candidate = ROLE_CANDIDATE[job.searchRole] || ROLE_CANDIDATE['GENERAL'] || getCandidateFromEnv();

    logger.info(`\n👤 Role: ${job.searchRole} → Candidate: ${candidate.name}`);
    logger.info(`📄 Resume: ${path.basename(candidate.resume)}`);

    // Check resume exists
    if (!fs.existsSync(candidate.resume)) {
      logger.warn(`Resume missing for ${candidate.name}: ${candidate.resume} — skipping`);
      results.push({ jobPost: job, success: false, error: 'Resume file not found' });
      continue;
    }

    // AI tailoring — skip if TAILOR_RESUME=no in .env
    const shouldTailor = (process.env.TAILOR_RESUME || 'yes').toLowerCase() === 'yes';
    let tailoredSummary = null;
    let attachments;

    if (shouldTailor) {
      logger.info(`🤖 Tailoring professional summary for ${candidate.name}...`);
      tailoredSummary = await tailorProfessionalSummary(job.fullDescription, candidate, job.searchRole);
      attachments = await buildTailoredResumeAttachment(job, candidate, tailoredSummary);
    } else {
      logger.info(`📎 Skipping resume tailoring (TAILOR_RESUME=no) — attaching original`);
      attachments = [{ filename: `${candidate.name.replace(/ /g,'_')}_Resume.pdf`, path: candidate.resume }];
    }

    const { subject, html, text } = await composeEmail(job, tailoredSummary, candidate);

    const opts = {
      from:    `"${candidate.name}" <${process.env.GMAIL_EMAIL}>`,
      to:      job.recruiterEmail,
      ...(CC_EMAIL  ? { cc:  CC_EMAIL  } : {}),
      ...(BCC_EMAIL ? { bcc: BCC_EMAIL } : {}),
      subject,
      text,
      html,
      attachments,
    };

    try {
      const info = await transporter.sendMail(opts);
      logger.info(`📧 Sent: ${candidate.name} → ${job.recruiterEmail} | Subject: ${subject.slice(0,60)} | ID: ${info.messageId}`);
      if (onSent) onSent(job.recruiterEmail);
      results.push({ jobPost: job, success: true });
    } catch(err) {
      logger.error(`Failed to send to ${job.recruiterEmail}: ${err.message}`);
      results.push({ jobPost: job, success: false, error: err.message });
    }

    // Cleanup temp tailored resume
    try {
      const baseName    = path.basename(candidate.resume, '.pdf');
      const tailoredPath = path.resolve(`./assets/${baseName}_Tailored.pdf`);
      if (fs.existsSync(tailoredPath)) fs.unlinkSync(tailoredPath);
    } catch(e) {}

    await sleep(2500 + Math.random() * 1000);
  }

  return results;
}

const escHtml = (str) =>
  String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = { sendApplicationEmails };
