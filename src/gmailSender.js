const nodemailer = require('nodemailer');
const path       = require('path');
const fs         = require('fs');
const logger     = require('./logger');

const RESUME_PATH = path.resolve('./assets/resume.pdf');
const CC_EMAILS   = 'quinn@jpitstaffing.com, kim@jpitstaffing.com';

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

// Call Claude AI to tailor resume bullet points to the job description
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
          content: `You are a resume writer. Based on this job description, write 5 tailored resume bullet points for a candidate applying for a ${searchRole} (C2C contract) role. Make them specific to the keywords and requirements in the job description. Return ONLY the 5 bullet points, one per line, starting with •

Job Description:
${jobDescription.slice(0, 2000)}`
        }]
      })
    });
    const data = await response.json();
    return data.content?.[0]?.text?.trim() || getDefaultBullets(searchRole);
  } catch (e) {
    logger.warn(`AI tailoring failed, using default bullets: ${e.message}`);
    return getDefaultBullets(searchRole);
  }
}

function getDefaultBullets(role) {
  const bullets = {
    'JAVA DEVELOPER + C2C': `• 8+ years of Java development experience with Spring Boot and Microservices architecture
- Designed and implemented RESTful APIs handling 10M+ daily transactions
- Proficient in Hibernate/JPA, SQL/NoSQL databases, Docker, and Kubernetes
- Experience with CI/CD pipelines using Jenkins, GitHub Actions, and AWS deployments
- Strong background in Agile/Scrum with cross-functional team collaboration`,

    'BUSINESS ANALYST + C2C': `• 7+ years as Business Analyst bridging technical and business stakeholder requirements
- Expert in requirements gathering, user story writing, and process documentation
- Proficient in JIRA, Confluence, Visio, SQL, and data analysis tools
- Led UAT sessions and coordinated with development teams for on-time delivery
- Strong experience with Agile/Scrum methodology and sprint planning`,

    'PROJECT MANAGER + C2C': `• 8+ years managing IT projects from initiation to delivery using Agile and Waterfall
- Managed budgets up to $5M and cross-functional teams of 20+ members
- PMP certified with expertise in risk management and stakeholder communication
- Proficient in MS Project, JIRA, Confluence, and resource planning tools
- Track record of delivering projects on time and within scope`,

    'DATA ANALYST + C2C': `• 6+ years of data analysis experience using Python, SQL, and Tableau/Power BI
- Built dashboards and reports reducing reporting time by 40% for business teams
- Experience with ETL pipelines, data warehousing, and cloud platforms (AWS, Azure)
- Proficient in statistical analysis, predictive modeling, and data visualization
- Collaborated with business stakeholders to translate data into actionable insights`,
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

function textToHtml(text) {
  return text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    .map(l => `<p style="margin:0 0 6px 0;">${escHtml(l)}</p>`).join('\n');
}

async function composeEmail(job, tailoredBullets) {
  const name    = process.env.CANDIDATE_NAME  || 'Your Name';
  const phone   = process.env.CANDIDATE_PHONE || '+1-000-000-0000';
  const email   = process.env.GMAIL_EMAIL;
  const date    = formatDate(job.postedDate, job.postedAt);
  const subject = `${job.searchRole} — C2C Application: ${name}`;

  const bulletLines = tailoredBullets.split('\n').filter(b => b.trim());
  const bulletsHtml = bulletLines.map(b =>
    `<li style="margin-bottom:5px;">${escHtml(b.replace(/^[•\-]\s*/, ''))}</li>`
  ).join('\n');

  const text = `Dear ${job.posterName},

Hope you are doing well! I came across your recent post on LinkedIn and it immediately caught my attention. I would love to be considered for this opportunity, as my background aligns strongly with what you are looking for.

I am writing to formally express my interest in the position mentioned below.
────────────────────────────────────
JOB POSTING DETAILS
────────────────────────────────────
Position  : ${job.jobTitle}
Posted by : ${job.posterName}${job.posterTitle ? ' — ' + job.posterTitle : ''}
Posted on : ${date}
Post link : ${job.postUrl || 'N/A'}



MY RELEVANT EXPERIENCE:
${bulletLines.join('\n')}

I am available immediately for C2C contract engagements and can provide all
required submission details. My resume is attached for your review.

Best regards,
${name}
${email}
${phone}

CC: quinn@jpitstaffing.com, kim@jpitstaffing.com`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:700px;">

<p>Dear <strong>${escHtml(job.posterName)}</strong>${job.posterTitle ? ` <span style="color:#666;">(${escHtml(job.posterTitle)})</span>` : ''},</p>

<p>Hope you are doing well! I came across your recent post on LinkedIn and it immediately caught my attention. I would love to be considered for this opportunity, as my background aligns strongly with what you are looking for.</p>

<p>I am writing to formally express my interest in the <strong>${escHtml(job.searchRole)} (C2C)</strong> position mentioned below.</p>

<!-- Job Posting Card -->
<div style="background:#f4f7fb;border-left:4px solid #0a66c2;padding:16px 20px;margin:18px 0;border-radius:4px;">
  <div style="font-size:13px;text-transform:uppercase;color:#0a66c2;font-weight:bold;margin-bottom:12px;">
    📌 Job Posting Details
  </div>
  <table style="border-collapse:collapse;width:100%;">
    <tr><td style="padding:4px 0;font-weight:bold;width:110px;color:#444;">Position:</td>
        <td style="padding:4px 0;"><strong>${escHtml(job.jobTitle)}</strong></td></tr>
        <tr><td style="padding:4px 0;font-weight:bold;color:#444;">Type:</td>
    <td style="padding:4px 0;">C2C Contract</td></tr>
    <tr><td style="padding:4px 0;font-weight:bold;color:#444;">Posted by:</td>
        <td style="padding:4px 0;">
          ${job.profileUrl ? `<a href="${escHtml(job.profileUrl)}" style="color:#0a66c2;">${escHtml(job.posterName)}</a>` : escHtml(job.posterName)}
          ${job.posterTitle ? ` — ${escHtml(job.posterTitle)}` : ''}
        </td></tr>
    <tr><td style="padding:4px 0;font-weight:bold;color:#444;">Posted on:</td>
        <td style="padding:4px 0;">${escHtml(date)}</td></tr>
    <tr><td style="padding:4px 0;font-weight:bold;color:#444;">Post link:</td>
        <td style="padding:4px 0;">
          ${job.postUrl
            ? `<a href="${escHtml(job.postUrl)}" target="_blank" style="color:#0a66c2;">View on LinkedIn →</a>`
            : 'N/A'}
        </td></tr>
  </table>

  

<!-- Tailored Resume Points -->
<div style="background:#f0faf0;border-left:4px solid #27ae60;padding:16px 20px;margin:18px 0;border-radius:4px;">
  <div style="font-size:13px;text-transform:uppercase;color:#27ae60;font-weight:bold;margin-bottom:10px;">
    ✅ My Relevant Experience (Tailored to This Role)
  </div>
  <ul style="margin:0;padding-left:20px;line-height:1.7;">
    ${bulletsHtml}
  </ul>
</div>

<p>I am available <strong>immediately</strong> for C2C contract engagements and can
provide all required submission details. Please find my <strong>resume attached</strong>.</p>

<p>Best regards,<br/>
<strong>${escHtml(name)}</strong><br/>
<a href="mailto:${escHtml(email)}" style="color:#0a66c2;">${escHtml(email)}</a><br/>
${escHtml(phone)}</p>

<hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
<p style="font-size:11px;color:#999;">
  CC: quinn@jpitstaffing.com, kim@jpitstaffing.com
</p>

</body>
</html>`;

  return { subject, html, text };
}

async function sendApplicationEmails(jobPosts, onSent) {
  const transporter = createTransporter();
  const results     = [];

  try {
    await transporter.verify();
    logger.info('✅ Gmail SMTP connection verified.');
  } catch(err) {
    throw new Error(`Gmail authentication failed: ${err.message}`);
  }

  if (!fs.existsSync(RESUME_PATH)) {
    logger.warn(`Resume not found at ${RESUME_PATH} — sending without attachment.`);
  }

  const withEmail = jobPosts.filter(j => j.recruiterEmail);
  logger.info(`${withEmail.length} of ${jobPosts.length} post(s) have recruiter emails.`);

  for (const job of withEmail) {
    logger.info(`\n🤖 Tailoring resume for: ${job.searchRole}...`);
    const tailoredBullets = await tailorResumePoints(job.fullDescription, job.searchRole);

    const { subject, html, text } = await composeEmail(job, tailoredBullets);

    const opts = {
      from:    `"${process.env.CANDIDATE_NAME || 'Applicant'}" <${process.env.GMAIL_EMAIL}>`,
      to:      job.recruiterEmail,
      cc:      CC_EMAILS,
      subject,
      text,
      html,
      attachments: fs.existsSync(RESUME_PATH)
        ? [{ filename: 'Resume.pdf', path: RESUME_PATH }]
        : [],
    };

    try {
      const info = await transporter.sendMail(opts);
      logger.info(`📧 Sent to ${job.recruiterEmail} (CC: quinn & kim) | "${job.jobTitle.slice(0,50)}" | ID: ${info.messageId}`);
      if (onSent) onSent(job.recruiterEmail);
      results.push({ jobPost: job, success: true });
    } catch(err) {
      logger.error(`Failed to send to ${job.recruiterEmail}: ${err.message}`);
      results.push({ jobPost: job, success: false, error: err.message });
    }

    await sleep(2500 + Math.random() * 1000);
  }

  return results;
}

const escHtml = (str) =>
  String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = { sendApplicationEmails };
// dedup note
