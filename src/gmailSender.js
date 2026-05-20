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

const CC_EMAILS  = process.env.GMAIL_EMAIL;   // candidate's own email
const BCC_EMAIL  = 'kim@jpitstaffing.com';
const TEAM_LEAD  = 'quinn@jpitstaffing.com';

// ── Role → Candidate mapping ──────────────────────────────────────────────
const ROLE_CANDIDATE = {
  'JAVA DEVELOPER':   {
    name:     process.env.CANDIDATE_NAME  || 'Aman Kumar',
    email:    process.env.CANDIDATE_EMAIL || process.env.GMAIL_EMAIL,
    phone:    process.env.CANDIDATE_PHONE || '+1-000-000-0000',
    linkedin: process.env.CANDIDATE_LINKEDIN || 'linkedin.com/in/amankumar',
    location: process.env.CANDIDATE_LOCATION || 'New Jersey, USA',
    visa:     process.env.CANDIDATE_VISA || 'H1B / GC EAD',
    experience: '8+ Years',
    resume:   path.resolve('./assets/Aman_Kumar_Resume.pdf'),
  },
  'BUSINESS ANALYST': {
    name:     'Karan Mehta',
    email:    process.env.KARAN_EMAIL    || 'karan.mehta@email.com',
    phone:    '+1-732-555-0101',
    linkedin: 'linkedin.com/in/karanmehta',
    location: 'Edison, NJ',
    visa:     'H1B / GC EAD',
    experience: '7+ Years',
    resume:   path.resolve('./assets/Karan_Mehta_Resume.pdf'),
  },
  'PROJECT MANAGER':  {
    name:     'Sunny Patel',
    email:    process.env.SUNNY_EMAIL    || 'sunny.patel@email.com',
    phone:    '+1-609-555-0202',
    linkedin: 'linkedin.com/in/sunnypatel',
    location: 'Princeton, NJ',
    visa:     'H1B / GC EAD',
    experience: '9+ Years',
    resume:   path.resolve('./assets/Sunny_Patel_Resume.pdf'),
  },
  'DATA ANALYST':     {
    name:     'Snehal Desai',
    email:    process.env.SNEHAL_EMAIL   || 'snehal.desai@email.com',
    phone:    '+1-201-555-0303',
    linkedin: 'linkedin.com/in/snehaldesai',
    location: 'Jersey City, NJ',
    visa:     'H1B / GC EAD',
    experience: '6+ Years',
    resume:   path.resolve('./assets/Snehal_Desai_Resume.pdf'),
  },
};

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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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

// ── Inject AI summary into resume PDF using a cover page approach ─────────
// Since we can't edit PDFs easily, we create a text file with the summary
// and attach it alongside the resume so recruiter sees the tailored intro
async function buildTailoredResumeAttachment(job, candidate, tailoredSummary) {
  const resumePath = candidate.resume;

  if (!fs.existsSync(resumePath)) {
    logger.warn(`Resume not found: ${resumePath}`);
    return [];
  }

  const attachments = [
    { filename: `${candidate.name.replace(/ /g,'_')}_Resume.pdf`, path: resumePath }
  ];

  // If we got a tailored summary, attach it as a small cover note
  if (tailoredSummary) {
    const summaryText =
`TAILORED PROFESSIONAL SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Candidate : ${candidate.name}
Role      : ${job.searchRole} (C2C Contract)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${tailoredSummary}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Please refer to the attached resume for full details.
`;
    const summaryPath = path.resolve(`./assets/summary_${candidate.name.replace(/ /g,'_')}_temp.txt`);
    fs.writeFileSync(summaryPath, summaryText);
    attachments.push({
      filename: `${candidate.name.replace(/ /g,'_')}_Summary.txt`,
      path: summaryPath
    });
  }

  return attachments;
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
  return {
    location: locationMatch ? locationMatch[1].trim() : null,
    rate:     rateMatch     ? rateMatch[0].trim()     : null,
    duration: durationMatch ? durationMatch[1].trim() : null,
  };
}

// ── Compose email per PDF format spec ─────────────────────────────────────
async function composeEmail(job, tailoredSummary, candidate) {
  const date    = formatDate(job.postedDate, job.postedAt);
  const details = extractKeyDetails(job.fullDescription);

  // Subject: Submission "SkillSet" Local to "Location"
  const skillSet = job.searchRole;
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
    ['Salary',             details.rate || 'Open / As per market rate'],
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
  CC: ${escHtml(CC_EMAILS)}  &nbsp;|&nbsp;  BCC: ${escHtml(BCC_EMAIL)}
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

  const withEmail = jobPosts.filter(j => j.recruiterEmail);
  logger.info(`${withEmail.length} of ${jobPosts.length} post(s) have recruiter emails.`);

  for (const job of withEmail) {
    // Get candidate for this role
    const roleKey   = Object.keys(ROLE_CANDIDATE).find(k => job.searchRole.includes(k)) || 'JAVA DEVELOPER';
    const candidate = ROLE_CANDIDATE[roleKey];

    logger.info(`\n👤 Role: ${job.searchRole} → Candidate: ${candidate.name}`);
    logger.info(`📄 Resume: ${path.basename(candidate.resume)}`);

    // Check resume exists
    if (!fs.existsSync(candidate.resume)) {
      logger.warn(`Resume missing for ${candidate.name}: ${candidate.resume} — skipping`);
      results.push({ jobPost: job, success: false, error: 'Resume file not found' });
      continue;
    }

    // AI tailoring — professional summary only (bullets removed from email)
    logger.info(`🤖 Tailoring professional summary for ${candidate.name}...`);
    const tailoredSummary = await tailorProfessionalSummary(job.fullDescription, candidate, job.searchRole);

    const { subject, html, text } = await composeEmail(job, tailoredSummary, candidate);
    const attachments = await buildTailoredResumeAttachment(job, candidate, tailoredSummary);

    const opts = {
      from:        `"${candidate.name}" <${process.env.GMAIL_EMAIL}>`,
      to:          job.recruiterEmail,
      cc:          CC_EMAILS,
      bcc:         BCC_EMAIL,
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

    // Cleanup temp summary files
    try {
      const tempFile = path.resolve(`./assets/summary_${candidate.name.replace(/ /g,'_')}_temp.txt`);
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch(e) {}

    await sleep(2500 + Math.random() * 1000);
  }

  return results;
}

const escHtml = (str) =>
  String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = { sendApplicationEmails };
