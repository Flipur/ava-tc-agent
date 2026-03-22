import sys
import json
import urllib.request
import tempfile
import os
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable, Image, PageBreak
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_RIGHT, TA_LEFT, TA_CENTER, TA_JUSTIFY
from datetime import datetime

DARK_BLUE   = colors.HexColor('#1B3A5C')
MID_BLUE    = colors.HexColor('#2B5F8E')
LIGHT_BLUE  = colors.HexColor('#A8C8E0')
CRITICAL_RED= colors.HexColor('#C0392B')
MAJOR_ORANGE= colors.HexColor('#E67E22')
MOD_YELLOW  = colors.HexColor('#F39C12')
GREEN       = colors.HexColor('#27AE60')
LIGHT_GRAY  = colors.HexColor('#F5F7FA')
MID_GRAY    = colors.HexColor('#888888')
DARK_GRAY   = colors.HexColor('#333333')
WHITE       = colors.white

SEV_COLORS = {
    'CRITICAL': colors.HexColor('#C0392B'),
    'MAJOR':    colors.HexColor('#E67E22'),
    'MODERATE': colors.HexColor('#F39C12'),
    'MINOR':    colors.HexColor('#27AE60'),
    'INFO':     colors.HexColor('#2B5F8E'),
}

def dl_image(url, tmp):
    try:
        p = os.path.join(tmp, 'img_' + str(abs(hash(url))) + '.jpg')
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=12) as r:
            open(p, 'wb').write(r.read())
        return p
    except:
        return None

def sty(name, **kw):
    return ParagraphStyle(name, **kw)

def section_bar(text, story):
    tbl = Table([[Paragraph(text, sty('sb', fontSize=10, textColor=WHITE,
                  fontName='Helvetica-Bold', leading=13))]], colWidths=[7.2*inch])
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0,0),(-1,-1), DARK_BLUE),
        ('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),
        ('LEFTPADDING',(0,0),(-1,-1),10),
    ]))
    story.append(tbl)
    story.append(Spacer(1,6))

def subsection_bar(text, story):
    tbl = Table([[Paragraph(text, sty('ssb', fontSize=9, textColor=WHITE,
                  fontName='Helvetica-Bold'))]], colWidths=[7.2*inch])
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0,0),(-1,-1), MID_BLUE),
        ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
        ('LEFTPADDING',(0,0),(-1,-1),10),
    ]))
    story.append(tbl)
    story.append(Spacer(1,4))

def photo_grid(photos, tmp, story, cols=2):
    if not photos: return
    paths = []
    for p in photos[:12]:
        url = p.get('url','')
        cap = p.get('caption','')
        if url:
            ip = dl_image(url, tmp)
            if ip: paths.append((ip, cap))
    for i in range(0, len(paths), cols):
        row = []
        for j in range(cols):
            if i+j < len(paths):
                ip, cap = paths[i+j]
                try:
                    img = Image(ip, width=3.2*inch, height=2.2*inch)
                    cp  = Paragraph(cap, sty('cap', fontSize=7, textColor=MID_GRAY,
                                    leading=10, alignment=TA_CENTER))
                    row.append([img, Spacer(1,3), cp])
                except:
                    row.append([Paragraph('(unavailable)', sty('na', fontSize=8, textColor=MID_GRAY))])
            else:
                row.append([''])
        pt = Table([row], colWidths=[3.55*inch]*cols)
        pt.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),
            ('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
        story.append(pt)

def generate_inspection(data, output_path):
    doc = SimpleDocTemplate(output_path, pagesize=letter,
        rightMargin=0.65*inch, leftMargin=0.65*inch,
        topMargin=0.65*inch, bottomMargin=0.65*inch)
    story = []
    tmp = tempfile.mkdtemp()

    # HEADER
    hdr = Table([[
        Paragraph('TRI COUNTY<br/>INSPECTION AND PROJECT MANAGEMENT',
            sty('h', fontSize=20, textColor=WHITE, fontName='Helvetica-Bold',
                alignment=TA_CENTER, leading=24))
    ]], colWidths=[7.2*inch])
    hdr.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),DARK_BLUE),
        ('TOPPADDING',(0,0),(-1,-1),14),('BOTTOMPADDING',(0,0),(-1,-1),14)]))
    story.append(hdr)

    sub = Table([[
        Paragraph('PROPERTY INSPECTION REPORT',
            sty('s1', fontSize=13, textColor=WHITE, fontName='Helvetica-Bold', alignment=TA_CENTER)),
    ],[
        Paragraph('Comprehensive Condition &amp; Deficiency Assessment',
            sty('s2', fontSize=9, textColor=LIGHT_BLUE, alignment=TA_CENTER)),
    ]], colWidths=[7.2*inch])
    sub.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),MID_BLUE),
        ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
    story.append(sub)
    story.append(Spacer(1,10))

    # PROPERTY INFO
    date_str = datetime.now().strftime('%B %d, %Y')
    lbl = sty('lbl', fontSize=8, textColor=MID_GRAY, leading=12)
    val = sty('val', fontSize=9, textColor=DARK_GRAY, fontName='Helvetica-Bold', leading=12)

    info_rows = [
        ['Report Prepared For:', data.get('preparedFor','Flipur Companies'),
         'Report Date:', date_str],
        ['Report Number:', data.get('reportNumber','TRI-'+datetime.now().strftime('%Y%m%d-001')),
         'Property Type:', data.get('propertyType','Single-Family Residential')],
        ['Property Address:', data.get('propertyAddress','N/A'),
         'Inspector:', 'Tri County Inspection & Project Mgmt'],
        ['Occupancy Status:', data.get('propertyStatus','N/A'),
         'Utilities:', data.get('utilities','On at time of inspection')],
    ]
    cells = [[Paragraph(r[0],lbl),Paragraph(r[1],val),Paragraph(r[2],lbl),Paragraph(r[3],val)]
             for r in info_rows]
    it = Table(cells, colWidths=[1.5*inch,2.1*inch,1.5*inch,2.1*inch])
    it.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(-1,-1),LIGHT_GRAY),
        ('GRID',(0,0),(-1,-1),0.25,colors.HexColor('#DDDDDD')),
        ('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4),
        ('LEFTPADDING',(0,0),(-1,-1),6),
    ]))
    story.append(it)
    story.append(Spacer(1,10))

    # OVERALL RATING
    overall = data.get('overallCondition','FAIR').upper()
    rc = CRITICAL_RED if any(w in overall for w in ['CRITICAL','NOT HABITABLE','POOR']) \
         else (MAJOR_ORANGE if 'FAIR' in overall else GREEN)
    rt = Table([[Paragraph('OVERALL CONDITION RATING: ' + overall,
                sty('rc', fontSize=12, textColor=WHITE, fontName='Helvetica-Bold',
                    alignment=TA_CENTER))]], colWidths=[7.2*inch])
    rt.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),rc),
        ('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
    story.append(rt)

    if data.get('overallSummary'):
        nt = Table([[Paragraph(data['overallSummary'],
                    sty('ns', fontSize=9, textColor=DARK_GRAY, leading=13,
                        alignment=TA_JUSTIFY))]], colWidths=[7.2*inch])
        nt.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#FEF9F9')),
            ('BOX',(0,0),(-1,-1),1,rc),
            ('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),
            ('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10)]))
        story.append(nt)
    story.append(Spacer(1,12))

    # SECTION 1: EXECUTIVE SUMMARY
    section_bar('SECTION 1: EXECUTIVE SUMMARY', story)

    if data.get('executiveSummary'):
        story.append(Paragraph(data['executiveSummary'],
            sty('es', fontSize=9, textColor=DARK_GRAY, leading=13, alignment=TA_JUSTIFY)))
        story.append(Spacer(1,10))

    critical = data.get('criticalIssues', [])
    major    = data.get('majorIssues', [])
    if critical or major:
        story.append(Paragraph('Key Findings at a Glance',
            sty('kfh', fontSize=11, textColor=DARK_BLUE, fontName='Helvetica-Bold')))
        story.append(Spacer(1,5))
        mx = max(len(critical), len(major), 1)
        kf = [[
            Paragraph('CRITICAL ISSUES FOUND', sty('kfc',fontSize=9,textColor=WHITE,fontName='Helvetica-Bold')),
            Paragraph('MAJOR ISSUES FOUND',    sty('kfm',fontSize=9,textColor=WHITE,fontName='Helvetica-Bold')),
        ]]
        for i in range(mx):
            kf.append([
                Paragraph('• '+critical[i] if i<len(critical) else '',
                    sty('kfcv'+str(i),fontSize=9,textColor=DARK_GRAY,leading=13)),
                Paragraph('• '+major[i]    if i<len(major)    else '',
                    sty('kfmv'+str(i),fontSize=9,textColor=DARK_GRAY,leading=13)),
            ])
        kft = Table(kf, colWidths=[3.6*inch,3.6*inch])
        kft.setStyle(TableStyle([
            ('BACKGROUND',(0,0),(0,0),CRITICAL_RED),('BACKGROUND',(1,0),(1,0),MAJOR_ORANGE),
            ('BACKGROUND',(0,1),(0,-1),colors.HexColor('#FDF2F2')),
            ('BACKGROUND',(1,1),(1,-1),colors.HexColor('#FEF9F0')),
            ('GRID',(0,0),(-1,-1),0.25,colors.HexColor('#DDDDDD')),
            ('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),
