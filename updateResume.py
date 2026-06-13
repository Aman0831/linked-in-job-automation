#!/usr/bin/env python3
"""
updateResume.py  —  Universal Resume Tailoring Script
──────────────────────────────────────────────────────
Works for ANY candidate PDF automatically.

1. Extracts all text + structure from the input PDF using pdfplumber
2. Replaces the Professional Summary with the AI-tailored one
3. Injects new skills into the skills section
4. Rebuilds a clean, professional PDF using reportlab

Usage:
  python3 updateResume.py \
    --input  assets/Mohsin_Resume.pdf \
    --output assets/Mohsin_Resume_Tailored.pdf \
    --summary "New tailored summary text..." \
    --skills  "Looker Studio, Mixpanel, A/B Testing"
"""

import argparse
import sys
import re
import pdfplumber
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle
)

# ── Colors ─────────────────────────────────────────────────────────────────
DARK = colors.HexColor('#1a1a2e')
BLUE = colors.HexColor('#0a66c2')
GRAY = colors.HexColor('#555555')

def style(name, **kw):
    base = dict(fontName='Helvetica', fontSize=10, textColor=DARK, leading=14, spaceAfter=0)
    base.update(kw)
    return ParagraphStyle(name, **base)

def HR():
    return HRFlowable(width='100%', thickness=0.5, color=colors.HexColor('#cccccc'),
                      spaceAfter=4, spaceBefore=2)

def SP(h=4):
    return Spacer(1, h)

def P(text, s):
    safe = str(text or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    return Paragraph(safe, s)

def B(text, s):
    safe = str(text or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    return Paragraph(f'● {safe}', s)

# ── Styles ──────────────────────────────────────────────────────────────────
name_s     = style('name',    fontSize=20, fontName='Helvetica-Bold', spaceAfter=2, leading=24)
title_s    = style('title',   fontSize=12, fontName='Helvetica-Bold', textColor=GRAY, spaceAfter=2)
contact_s  = style('contact', fontSize=9,  textColor=GRAY, spaceAfter=6)
section_s  = style('section', fontSize=10, fontName='Helvetica-Bold', textColor=BLUE,
                   spaceBefore=8, spaceAfter=3)
body_s     = style('body',    fontSize=9.5, leading=14, spaceAfter=3)
bullet_s   = style('bullet',  fontSize=9.5, leading=13, leftIndent=10, spaceAfter=2)
jobtitle_s = style('jt',      fontSize=9.5, fontName='Helvetica-Bold', spaceAfter=0)
jobmeta_s  = style('jm',      fontSize=9,   textColor=GRAY, spaceAfter=2)
small_s    = style('small',   fontSize=8.5, textColor=DARK, leading=13, spaceAfter=2)
right_s    = style('right',   fontSize=9.5, fontName='Helvetica-Bold', alignment=2, spaceAfter=0)
loc_s      = style('loc',     fontSize=9,   textColor=GRAY, alignment=2, spaceAfter=2)

# ── Known section heading patterns ─────────────────────────────────────────
SECTION_PATTERNS = [
    r'^(PROFESSIONAL\s+SUMMARY|SUMMARY|OBJECTIVE|PROFILE)$',
    r'^(SKILLS?|TECHNICAL\s+SKILLS?|CORE\s+COMPETENCIES|TOOLS?\s*&?\s*TECHNOLOGIES?)$',
    r'^(PROFESSIONAL\s+EXPERIENCE|WORK\s+EXPERIENCE|EXPERIENCE|EMPLOYMENT)$',
    r'^(EDUCATION|ACADEMIC\s+BACKGROUND)$',
    r'^(PROJECTS?|PERSONAL\s+PROJECTS?)$',
    r'^(CERTIFICATIONS?|LICENSES?\s*&?\s*CERTIFICATIONS?)$',
    r'^(RESPONSIBILITIES?)$',
    r'^(AWARDS?|ACHIEVEMENTS?|HONORS?)$',
    r'^(PUBLICATIONS?|RESEARCH)$',
    r'^(VOLUNTEERING?|COMMUNITY\s+SERVICE)$',
    r'^(LANGUAGES?)$',
    r'^(INTERESTS?|HOBBIES)$',
]

def is_section_heading(line):
    line = line.strip().rstrip(':').upper()
    for pat in SECTION_PATTERNS:
        if re.match(pat, line):
            return True
    return False

def looks_like_contact(line):
    """Detect contact info lines: email, phone, linkedin, location."""
    line = line.lower()
    return (
        '@' in line or
        re.search(r'\+?[\d\s\(\)\-]{7,}', line) or
        'linkedin' in line or
        'github' in line or
        re.search(r'\b(ny|ca|tx|fl|wa|il|remote)\b', line) or
        '|' in line
    )

# ── PDF Parser ──────────────────────────────────────────────────────────────
def extract_resume_data(pdf_path):
    """
    Extract structured data from any resume PDF.
    Returns a dict with: name, job_title, contact, sections
    Each section: { heading, lines[] }
    """
    all_lines = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                all_lines.extend(text.split('\n'))

    # Clean lines
    lines = [l.replace('(cid:127)', '●').strip() for l in all_lines if l.strip()]

    if not lines:
        raise ValueError(f"Could not extract text from {pdf_path}")

    # ── Detect header: name (line 0), optional job title (line 1), contact ──
    name = lines[0] if lines else 'Candidate'
    idx = 1

    # Optional: second line might be a job title (no @, no digits-heavy)
    job_title = ''
    if idx < len(lines) and not looks_like_contact(lines[idx]) and not is_section_heading(lines[idx]):
        candidate = lines[idx]
        # Looks like a title if it's short and mostly alpha
        if len(candidate) < 60 and sum(c.isalpha() or c.isspace() for c in candidate) / max(len(candidate),1) > 0.7:
            job_title = candidate
            idx += 1

    # Collect contact lines (until we hit a section heading or non-contact text)
    contact_lines = []
    while idx < len(lines) and not is_section_heading(lines[idx]):
        if looks_like_contact(lines[idx]) or '|' in lines[idx]:
            contact_lines.append(lines[idx])
            idx += 1
        else:
            # Non-contact, non-heading text — this is body content (e.g. an
            # unlabeled professional summary paragraph). Stop here so it
            # becomes part of an implicit "PROFESSIONAL SUMMARY" section below.
            break

    # ── Parse sections ──────────────────────────────────────────────────────
    sections = []  # list of { heading, lines[] }
    current_section = None

    # If the next line isn't a recognized section heading AND no real
    # PROFESSIONAL SUMMARY/OBJECTIVE/PROFILE heading exists later in the
    # resume, treat this as an unlabeled intro/summary block so it isn't
    # silently dropped. If a real summary heading exists later, leave these
    # leading lines (usually job title/contact) to be dropped as before.
    remaining_has_summary_heading = any(
        is_section_heading(l) and
        re.match(r'(PROFESSIONAL\s+)?SUMMARY|OBJECTIVE|PROFILE', l.strip().rstrip(':').upper())
        for l in lines[idx:]
    )

    if (idx < len(lines) and not is_section_heading(lines[idx])
            and not remaining_has_summary_heading):
        current_section = {'heading': 'PROFESSIONAL SUMMARY', 'lines': []}

    while idx < len(lines):
        line = lines[idx]
        if is_section_heading(line):
            if current_section:
                sections.append(current_section)
            current_section = {'heading': line.strip(), 'lines': []}
        else:
            if current_section is not None:
                current_section['lines'].append(line)
        idx += 1

    if current_section:
        sections.append(current_section)

    return {
        'name':     name,
        'job_title': job_title,
        'contact':  contact_lines,
        'sections': sections,
    }

# ── Skills section rebuilder ────────────────────────────────────────────────
def inject_new_skills(skill_lines, new_skills_str):
    """
    Find the first bullet/line that looks like a skills list and append new skills to it.
    If no skills list found, append a new line.
    """
    if not new_skills_str:
        return skill_lines

    new_skills = [s.strip() for s in new_skills_str.split(',') if s.strip()]
    if not new_skills:
        return skill_lines

    result = list(skill_lines)

    # Find the first line that looks like a comma-separated skills list
    target_idx = None
    for i, line in enumerate(result):
        clean = line.lstrip('●•-– ').strip()
        if ',' in clean and len(clean) > 20:
            target_idx = i
            break

    if target_idx is not None:
        # Extract existing skills from that line
        clean = result[target_idx].lstrip('●•-– ').strip()
        # Remove label prefix like "CORE COMPETENCIES: " or "Skills: "
        if ':' in clean:
            prefix, existing = clean.split(':', 1)
            existing_list = [s.strip() for s in existing.split(',')]
            existing_upper = [s.upper() for s in existing_list]
            for skill in new_skills:
                if skill.upper() not in existing_upper:
                    existing_list.append(skill)
                    existing_upper.append(skill.upper())
            result[target_idx] = f"{prefix}: {', '.join(existing_list)}"
        else:
            existing_list = [s.strip() for s in clean.split(',')]
            existing_upper = [s.upper() for s in existing_list]
            for skill in new_skills:
                if skill.upper() not in existing_upper:
                    existing_list.append(skill)
                    existing_upper.append(skill.upper())
            result[target_idx] = ', '.join(existing_list)
    else:
        # No comma-separated line found — append as a new skills line
        result.append(', '.join(new_skills))

    return result

# ── PDF Builder ─────────────────────────────────────────────────────────────
def render_section_lines(lines, story):
    """
    Render a list of text lines into the story.
    Detects bullet points vs regular paragraphs.
    Uses a two-column table for lines that contain date ranges (job entries).
    """
    DATE_PAT = re.compile(
        r'(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|'
        r'June|July|August|September|October|November|December)'
        r'[\s\d]+[-–—]'
        r'\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|'
        r'June|July|August|September|October|November|December|Present|PRESENT|Current|CURRENT)?'
        r'[\s\d]*',
        re.IGNORECASE
    )
    YEAR_RANGE = re.compile(r'\b(19|20)\d{2}\s*[-–—]\s*((19|20)\d{2}|Present|PRESENT|Current)\b', re.IGNORECASE)

    i = 0
    while i < len(lines):
        line = lines[i]
        clean = line.lstrip('●•-– ').strip()

        if not clean:
            story.append(SP(2))
            i += 1
            continue

        is_bullet = line.startswith(('●', '•', '-', '–')) or line.startswith('  ')
        has_date  = DATE_PAT.search(line) or YEAR_RANGE.search(line)

        if has_date and not is_bullet and len(clean) < 120:
            # Looks like a job/edu header line — split date to right column
            # Try to split on date
            m = DATE_PAT.search(line) or YEAR_RANGE.search(line)
            if m:
                left  = line[:m.start()].strip().lstrip('●•-– ').strip()
                right = line[m.start():].strip()
                row = Table(
                    [[P(left, jobtitle_s), P(right, right_s)]],
                    colWidths=[4.5*inch, 2.8*inch]
                )
                row.setStyle(TableStyle([
                    ('VALIGN',       (0,0),(-1,-1),'TOP'),
                    ('LEFTPADDING',  (0,0),(-1,-1), 0),
                    ('RIGHTPADDING', (0,0),(-1,-1), 0),
                    ('BOTTOMPADDING',(0,0),(-1,-1), 0),
                ]))
                story.append(row)
            else:
                story.append(P(clean, jobtitle_s))
        elif is_bullet or (len(clean) < 200 and not has_date and i > 0):
            story.append(B(clean, bullet_s))
        else:
            story.append(P(clean, body_s))

        i += 1

    story.append(SP(4))

def build_resume(input_path, output_path, new_summary, new_skills_str):
    """Main function: parse input PDF, swap summary+skills, rebuild output PDF."""

    print(f'📖 Reading: {input_path}')
    data = extract_resume_data(input_path)

    print(f'   Candidate : {data["name"]}')
    print(f'   Sections  : {[s["heading"] for s in data["sections"]]}')

    doc = SimpleDocTemplate(
        output_path, pagesize=letter,
        leftMargin=0.6*inch, rightMargin=0.6*inch,
        topMargin=0.45*inch, bottomMargin=0.5*inch
    )

    story = []

    # ── Header ───────────────────────────────────────────────────────────────
    story.append(P(data['name'], name_s))
    if data['job_title']:
        story.append(P(data['job_title'], title_s))
    if data['contact']:
        story.append(P(' | '.join(data['contact']), contact_s))
    story.append(HR())

    # ── Ensure a Professional Summary exists ─────────────────────────────
    has_summary_section = any(
        re.match(r'(PROFESSIONAL\s+)?SUMMARY|OBJECTIVE|PROFILE', s['heading'].strip().upper())
        for s in data['sections']
    )
    if not has_summary_section and new_summary:
        story.append(P('PROFESSIONAL SUMMARY', section_s))
        story.append(P(new_summary, body_s))
        story += [SP(4), HR()]

    # ── Sections ─────────────────────────────────────────────────────────────
    for section in data['sections']:
        heading = section['heading'].strip().upper()
        lines   = section['lines']

        story.append(P(heading, section_s))

        # ── Replace summary ────────────────────────────────────────────────
        if re.match(r'(PROFESSIONAL\s+)?SUMMARY|OBJECTIVE|PROFILE', heading):
            story.append(P(new_summary, body_s))
            story += [SP(4), HR()]
            continue

        # ── Inject skills ──────────────────────────────────────────────────
        if re.match(r'SKILLS?|TECHNICAL|CORE\s+COMP', heading):
            lines = inject_new_skills(lines, new_skills_str)

        render_section_lines(lines, story)
        story.append(HR())

    doc.build(story)
    print(f'✅ Tailored resume saved: {output_path}')

# ── Entry point ──────────────────────────────────────────────────────────────
if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input',   required=True,  help='Original resume PDF path')
    parser.add_argument('--output',  required=True,  help='Output tailored PDF path')
    parser.add_argument('--summary', required=True,  help='AI-tailored professional summary')
    parser.add_argument('--skills',  required=False, default='', help='Comma-separated new skills')
    args = parser.parse_args()

    try:
        build_resume(args.input, args.output, args.summary, args.skills)
    except Exception as e:
        print(f'❌ Error: {e}', file=sys.stderr)
        sys.exit(1)
