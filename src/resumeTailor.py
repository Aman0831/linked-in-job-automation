"""
resumeTailor.py
───────────────
Called by gmailSender.js via child_process.
Reads the original resume PDF, identifies missing keywords from job description,
and generates a new temporary PDF with:
  - Missing keywords appended to CORE COMPETENCIES cells
  - Updated PROFESSIONAL SUMMARY
Usage:
  python3 resumeTailor.py <resume_path> <output_path> <keywords_json> <new_summary>
"""

import sys
import json
import re
import os

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table,
    TableStyle, HRFlowable
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
import pdfplumber

# ── Colors (same as originals) ─────────────────────────────────────────────
NAVY       = colors.HexColor('#1E2761')
TEAL       = colors.HexColor('#0D9E9E')
LIGHT_BG   = colors.HexColor('#F4F7FB')
DARK_TEXT  = colors.HexColor('#1A1A2E')
MID_GRAY   = colors.HexColor('#555555')
LIGHT_GRAY = colors.HexColor('#888888')
GREEN      = colors.HexColor('#27AE60')
HIGHLIGHT  = colors.HexColor('#E8F5E9')  # light green for new keywords

# ── Styles ──────────────────────────────────────────────────────────────────
def make_styles():
    return {
        'name': ParagraphStyle('Name',
            fontSize=22, fontName='Helvetica-Bold',
            textColor=NAVY, alignment=TA_CENTER, spaceAfter=6),
        'tagline': ParagraphStyle('Tagline',
            fontSize=10, fontName='Helvetica',
            textColor=TEAL, alignment=TA_CENTER, spaceAfter=6),
        'contact': ParagraphStyle('Contact',
            fontSize=9, fontName='Helvetica',
            textColor=MID_GRAY, alignment=TA_CENTER, spaceAfter=8),
        'section': ParagraphStyle('Section',
            fontSize=11, fontName='Helvetica-Bold',
            textColor=NAVY, spaceBefore=10, spaceAfter=3),
        'job_title': ParagraphStyle('JobTitle',
            fontSize=10.5, fontName='Helvetica-Bold',
            textColor=DARK_TEXT, spaceAfter=1),
        'job_meta': ParagraphStyle('JobMeta',
            fontSize=9.5, fontName='Helvetica-Oblique',
            textColor=LIGHT_GRAY, spaceAfter=3),
        'bullet': ParagraphStyle('Bullet',
            fontSize=9.5, fontName='Helvetica',
            textColor=DARK_TEXT, leftIndent=12,
            spaceAfter=2, leading=14),
        'normal': ParagraphStyle('Normal',
            fontSize=9.5, fontName='Helvetica',
            textColor=DARK_TEXT, spaceAfter=3, leading=14),
        'skill_label': ParagraphStyle('SkillLabel',
            fontSize=9.5, fontName='Helvetica-Bold',
            textColor=NAVY, spaceAfter=2),
        'skill_val': ParagraphStyle('SkillVal',
            fontSize=9.5, fontName='Helvetica',
            textColor=DARK_TEXT, spaceAfter=4),
        'footer': ParagraphStyle('Footer',
            fontSize=9, fontName='Helvetica',
            alignment=TA_CENTER, textColor=NAVY),
        'dates': ParagraphStyle('Dates',
            fontSize=9.5, fontName='Helvetica',
            textColor=LIGHT_GRAY, alignment=TA_RIGHT),
    }

# ── Extract full text from PDF ───────────────────────────────────────────────
def extract_pdf_text(pdf_path):
    text = ""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text += (page.extract_text() or "") + "\n"
    return text

# ── Parse resume sections from extracted text ────────────────────────────────
def parse_resume(text):
    """Parse key sections from resume text."""
    lines = [l.strip() for l in text.split('\n') if l.strip()]

    result = {
        'name': '',
        'tagline': '',
        'contact': '',
        'summary': '',
        'core_competencies': [],  # list of [left, right] pairs
        'experiences': [],
        'education': [],
        'tech_skills': [],
        'raw_lines': lines
    }

    # Name is usually first line
    if lines:
        result['name'] = lines[0]
    if len(lines) > 1:
        result['tagline'] = lines[1]
    if len(lines) > 2:
        result['contact'] = lines[2]

    # Find sections
    current_section = None
    summary_lines = []
    competency_lines = []
    experience_lines = []
    edu_lines = []
    tech_lines = []

    for i, line in enumerate(lines):
        upper = line.upper()
        if 'PROFESSIONAL SUMMARY' in upper:
            current_section = 'summary'
            continue
        elif 'CORE COMPETENCIES' in upper:
            current_section = 'competencies'
            continue
        elif 'PROFESSIONAL EXPERIENCE' in upper:
            current_section = 'experience'
            continue
        elif 'EDUCATION' in upper and 'CERTIF' in upper:
            current_section = 'education'
            continue
        elif 'TECHNICAL SKILLS' in upper:
            current_section = 'tech_skills'
            continue

        if current_section == 'summary':
            summary_lines.append(line)
        elif current_section == 'competencies':
            competency_lines.append(line)
        elif current_section == 'experience':
            experience_lines.append(line)
        elif current_section == 'education':
            edu_lines.append(line)
        elif current_section == 'tech_skills':
            tech_lines.append(line)

    result['summary'] = ' '.join(summary_lines).strip()
    result['raw_competency_lines'] = competency_lines
    result['raw_experience_lines'] = experience_lines
    result['raw_edu_lines'] = edu_lines
    result['raw_tech_lines'] = tech_lines

    # Parse competency pairs (2 per line in original layout)
    # Each line in extracted text represents one row: "Left skill   Right skill"
    comp_pairs = []
    for line in competency_lines:
        # Split by 2+ spaces (column separator in PDF extraction)
        parts = re.split(r'\s{2,}', line.strip())
        if len(parts) >= 2:
            comp_pairs.append([parts[0].strip(), parts[1].strip()])
        elif len(parts) == 1 and parts[0]:
            comp_pairs.append([parts[0].strip(), ''])

    result['core_competencies'] = comp_pairs
    return result

# ── Identify which keywords are missing from resume ──────────────────────────
def find_missing_keywords(resume_text, keywords):
    """Return list of keywords NOT found in resume text (case-insensitive)."""
    resume_lower = resume_text.lower()
    missing = []
    for kw in keywords:
        kw_clean = kw.strip().lower()
        # Check if keyword or close variant exists in resume
        if kw_clean and kw_clean not in resume_lower:
            missing.append(kw.strip())
    return missing

# ── Add missing keywords into competency table ───────────────────────────────
def add_keywords_to_competencies(comp_pairs, missing_keywords):
    """
    Append missing keywords into existing cells of the competency table.
    Distributes evenly across existing rows.
    Returns updated comp_pairs.
    """
    if not missing_keywords or not comp_pairs:
        return comp_pairs

    import copy
    updated = copy.deepcopy(comp_pairs)

    # Distribute missing keywords across rows, alternating left/right
    kw_index = 0
    row_index = 0
    side = 1  # start appending to right column first (usually less full)

    while kw_index < len(missing_keywords):
        kw = missing_keywords[kw_index]
        row = updated[row_index % len(updated)]

        if side == 0:
            if row[0]:
                row[0] = row[0] + ' / ' + kw
            else:
                row[0] = kw
        else:
            if row[1]:
                row[1] = row[1] + ' / ' + kw
            else:
                row[1] = kw

        kw_index += 1
        row_index += 1
        side = 1 - side  # alternate left/right

    return updated

# ── Rebuild resume as new PDF ─────────────────────────────────────────────────
def rebuild_resume(parsed, output_path, new_summary, updated_competencies, missing_keywords):
    """Rebuild the full resume PDF with updated summary and competencies."""
    styles = make_styles()
    story = []

    # ── Header ────────────────────────────────────────────────────────────
    story.append(Paragraph(parsed['name'], styles['name']))
    story.append(Spacer(1, 4))
    story.append(Paragraph(parsed['tagline'], styles['tagline']))
    story.append(Spacer(1, 4))
    story.append(Paragraph(parsed['contact'], styles['contact']))
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width="100%", thickness=2, color=NAVY, spaceAfter=6))

    # ── Professional Summary (updated) ────────────────────────────────────
    story.append(Paragraph("PROFESSIONAL SUMMARY", styles['section']))
    story.append(HRFlowable(width="100%", thickness=0.5, color=TEAL, spaceAfter=5))
    story.append(Paragraph(new_summary, styles['normal']))

    # ── Core Competencies (with missing keywords added) ───────────────────
    story.append(Paragraph("CORE COMPETENCIES", styles['section']))
    story.append(HRFlowable(width="100%", thickness=0.5, color=TEAL, spaceAfter=5))

    # Build table data — highlight cells that contain new keywords
    table_data = []
    for left, right in updated_competencies:
        left_has_new  = any(kw.lower() in left.lower()  for kw in missing_keywords)
        right_has_new = any(kw.lower() in right.lower() for kw in missing_keywords)

        left_para  = Paragraph(f'<b>{left}</b>'  if left_has_new  else left,  styles['normal'])
        right_para = Paragraph(f'<b>{right}</b>' if right_has_new else right, styles['normal'])
        table_data.append([left_para, right_para])

    if table_data:
        skill_table = Table(table_data, colWidths=[3.5*inch, 3.5*inch])

        # Build style commands — highlight rows with new keywords
        style_cmds = [
            ('FONTNAME',    (0,0), (-1,-1), 'Helvetica'),
            ('FONTSIZE',    (0,0), (-1,-1), 9.5),
            ('TEXTCOLOR',   (0,0), (-1,-1), DARK_TEXT),
            ('LEFTPADDING', (0,0), (-1,-1), 8),
            ('TOPPADDING',  (0,0), (-1,-1), 3),
            ('BOTTOMPADDING',(0,0),(-1,-1), 3),
            ('BOX',         (0,0), (-1,-1), 0.5, colors.HexColor('#DDDDDD')),
            ('INNERGRID',   (0,0), (-1,-1), 0.3, colors.HexColor('#DDDDDD')),
        ]
        # Alternate background + highlight new keyword rows
        for i, (left, right) in enumerate(updated_competencies):
            left_has_new  = any(kw.lower() in left.lower()  for kw in missing_keywords)
            right_has_new = any(kw.lower() in right.lower() for kw in missing_keywords)
            if left_has_new or right_has_new:
                style_cmds.append(('BACKGROUND', (0,i), (-1,i), HIGHLIGHT))
            elif i % 2 == 0:
                style_cmds.append(('BACKGROUND', (0,i), (-1,i), LIGHT_BG))
            else:
                style_cmds.append(('BACKGROUND', (0,i), (-1,i), colors.white))

        skill_table.setStyle(TableStyle(style_cmds))
        story.append(skill_table)
        story.append(Spacer(1, 8))

    # ── Professional Experience ────────────────────────────────────────────
    story.append(Paragraph("PROFESSIONAL EXPERIENCE", styles['section']))
    story.append(HRFlowable(width="100%", thickness=0.5, color=TEAL, spaceAfter=5))

    exp_lines = parsed.get('raw_experience_lines', [])
    i = 0
    while i < len(exp_lines):
        line = exp_lines[i]
        # Date pattern: ends with year range like "Jan 2022 – Present"
        date_match = re.search(r'(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}', line)

        if date_match and i > 0:
            # This line has a date — it's a job title + date
            # Try to extract title part and date part
            date_pattern = r'((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s*[–\-]\s*(?:Present|\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}))'
            date_m = re.search(date_pattern, line)
            if date_m:
                title_part = line[:date_m.start()].strip()
                date_part  = date_m.group(1).strip()

                if title_part:
                    title_date = [[
                        Paragraph(title_part, styles['job_title']),
                        Paragraph(date_part, styles['dates'])
                    ]]
                    td = Table(title_date, colWidths=[4.5*inch, 2.5*inch])
                    td.setStyle(TableStyle([
                        ('LEFTPADDING',(0,0),(-1,-1),0),
                        ('RIGHTPADDING',(0,0),(-1,-1),0),
                        ('TOPPADDING',(0,0),(-1,-1),0),
                        ('BOTTOMPADDING',(0,0),(-1,-1),0),
                        ('VALIGN',(0,0),(-1,-1),'BOTTOM'),
                    ]))
                    story.append(td)
                else:
                    story.append(Paragraph(line, styles['job_title']))
            else:
                story.append(Paragraph(line, styles['job_title']))

        elif line.startswith('•'):
            story.append(Paragraph(line, styles['bullet']))
        elif re.search(r'(LLC|Inc\.|Corp\.|Ltd\.|Solutions|Systems|Analytics|Consulting|University|Institute)', line):
            story.append(Paragraph(line, styles['job_meta']))
        elif line:
            story.append(Paragraph(line, styles['normal']))

        i += 1

    story.append(Spacer(1, 5))

    # ── Education & Certifications ─────────────────────────────────────────
    story.append(Paragraph("EDUCATION & CERTIFICATIONS", styles['section']))
    story.append(HRFlowable(width="100%", thickness=0.5, color=TEAL, spaceAfter=5))

    edu_lines = parsed.get('raw_edu_lines', [])
    # Pair them as 2-column table
    edu_left  = [l for l in edu_lines if not l.startswith('•')]
    edu_certs = [l for l in edu_lines if l.startswith('•')]

    max_rows = max(len(edu_left), len(edu_certs), 1)
    edu_data = []
    for j in range(max_rows):
        left  = edu_left[j]  if j < len(edu_left)  else ''
        right = edu_certs[j] if j < len(edu_certs) else ''
        left_style  = styles['job_title'] if j == 0 else styles['normal']
        right_style = styles['job_title'] if j == 0 else styles['normal']
        edu_data.append([
            Paragraph(left,  left_style),
            Paragraph(right, right_style)
        ])

    if edu_data:
        edu_table = Table(edu_data, colWidths=[3.5*inch, 3.5*inch])
        edu_table.setStyle(TableStyle([
            ('FONTSIZE',(0,0),(-1,-1),9.5),
            ('LEFTPADDING',(0,0),(-1,-1),4),
            ('TOPPADDING',(0,0),(-1,-1),2),
            ('BOTTOMPADDING',(0,0),(-1,-1),2),
            ('VALIGN',(0,0),(-1,-1),'TOP'),
        ]))
        story.append(edu_table)
        story.append(Spacer(1, 8))

    # ── Technical Skills (if present) ─────────────────────────────────────
    tech_lines = parsed.get('raw_tech_lines', [])
    if tech_lines:
        story.append(Paragraph("TECHNICAL SKILLS", styles['section']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=TEAL, spaceAfter=5))
        for line in tech_lines:
            if ':' in line:
                parts = line.split(':', 1)
                ts_data = [[
                    Paragraph(parts[0].strip() + ':', styles['skill_label']),
                    Paragraph(parts[1].strip(), styles['skill_val']),
                ]]
                ts_table = Table(ts_data, colWidths=[1.3*inch, 5.7*inch])
                ts_table.setStyle(TableStyle([
                    ('LEFTPADDING',(0,0),(-1,-1),4),
                    ('TOPPADDING',(0,0),(-1,-1),1),
                    ('BOTTOMPADDING',(0,0),(-1,-1),1),
                    ('VALIGN',(0,0),(-1,-1),'TOP'),
                ]))
                story.append(ts_table)
            elif line:
                story.append(Paragraph(line, styles['normal']))

    # ── Footer ────────────────────────────────────────────────────────────
    story.append(Spacer(1, 8))
    story.append(HRFlowable(width="100%", thickness=1.5, color=NAVY, spaceAfter=4))
    story.append(Paragraph(
        "<font color='#1E2761'><b>Available for C2C Contract | Immediate Joiner | "
        "Authorized to Work in USA | Open to Remote / Hybrid / Onsite</b></font>",
        styles['footer']
    ))

    # ── Build PDF ─────────────────────────────────────────────────────────
    doc = SimpleDocTemplate(output_path,
        pagesize=letter,
        leftMargin=0.75*inch, rightMargin=0.75*inch,
        topMargin=0.6*inch,  bottomMargin=0.5*inch)
    doc.build(story)


# ── Main entry point ──────────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 5:
        print(json.dumps({"error": "Usage: resumeTailor.py <resume_pdf> <output_pdf> <keywords_json> <new_summary>"}))
        sys.exit(1)

    resume_path  = sys.argv[1]
    output_path  = sys.argv[2]
    keywords     = json.loads(sys.argv[3])   # list of strings
    new_summary  = sys.argv[4]

    if not os.path.exists(resume_path):
        print(json.dumps({"error": f"Resume not found: {resume_path}"}))
        sys.exit(1)

    # Step 1: Extract text from original resume
    resume_text = extract_pdf_text(resume_path)

    # Step 2: Parse resume structure
    parsed = parse_resume(resume_text)

    # Step 3: Find missing keywords
    missing = find_missing_keywords(resume_text, keywords)

    # Step 4: Add missing keywords to competency table
    updated_comps = add_keywords_to_competencies(
        parsed['core_competencies'], missing
    )

    # Step 5: Rebuild resume PDF with changes
    rebuild_resume(parsed, output_path, new_summary, updated_comps, missing)

    # Return result as JSON for Node.js to read
    print(json.dumps({
        "success": True,
        "output_path": output_path,
        "keywords_found": [k for k in keywords if k not in missing],
        "keywords_added": missing,
        "total_added": len(missing)
    }))

if __name__ == '__main__':
    main()
