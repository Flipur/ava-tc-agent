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
            ('LEFTPADDING',(0,0),(-1,-1),8),('VALIGN',(0,0),(-1,-1),'TOP'),
        ]))
        story.append(kft)
        story.append(Spacer(1,12))

    # SECTION 2: OVERVIEW
    overview_items = data.get('overviewItems', [])
    if overview_items:
        section_bar('SECTION 2: PROPERTY OVERVIEW', story)
        for item in overview_items:
            subsection_bar(item.get('title',''), story)
            for obs in item.get('observations', []):
                flagged = obs.get('flagged', False)
                txt = obs.get('text','')
                if not txt.startswith('•'): txt = '• ' + txt
                story.append(Paragraph(txt,
                    sty('obsf'+txt[:10] if flagged else 'obs'+txt[:10],
                        fontSize=9, textColor=CRITICAL_RED if flagged else DARK_GRAY,
                        fontName='Helvetica-Bold' if flagged else 'Helvetica',
                        leading=13, leftIndent=10)))
            story.append(Spacer(1,6))
            photo_grid(item.get('photos',[]), tmp, story)
            story.append(Spacer(1,8))

    # SECTION 3: DETAILED FINDINGS
    story.append(PageBreak())
    section_bar('SECTION 3: DETAILED INSPECTION FINDINGS', story)

    sev_leg = Table([[
        Paragraph('CRITICAL', sty('sl1',fontSize=8,textColor=WHITE,fontName='Helvetica-Bold',alignment=TA_CENTER)),
        Paragraph('= Immediate safety hazard', sty('sl1d',fontSize=8,textColor=DARK_GRAY)),
        Paragraph('MAJOR',    sty('sl2',fontSize=8,textColor=WHITE,fontName='Helvetica-Bold',alignment=TA_CENTER)),
        Paragraph('= Significant deficiency',  sty('sl2d',fontSize=8,textColor=DARK_GRAY)),
        Paragraph('MODERATE', sty('sl3',fontSize=8,textColor=WHITE,fontName='Helvetica-Bold',alignment=TA_CENTER)),
        Paragraph('= Repair within scope',     sty('sl3d',fontSize=8,textColor=DARK_GRAY)),
    ]], colWidths=[0.8*inch,1.6*inch,0.7*inch,1.65*inch,0.85*inch,1.6*inch])
    sev_leg.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(0,0),CRITICAL_RED),
        ('BACKGROUND',(2,0),(2,0),MAJOR_ORANGE),
        ('BACKGROUND',(4,0),(4,0),MOD_YELLOW),
        ('BACKGROUND',(1,0),(1,0),LIGHT_GRAY),
        ('BACKGROUND',(3,0),(3,0),LIGHT_GRAY),
        ('BACKGROUND',(5,0),(5,0),LIGHT_GRAY),
        ('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4),
        ('LEFTPADDING',(0,0),(-1,-1),5),('VALIGN',(0,0),(-1,-1),'MIDDLE'),
    ]))
    story.append(sev_leg)
    story.append(Spacer(1,10))

    sections = data.get('sections', [])
    for sec in sections:
        section_bar(sec.get('title',''), story)
        items = sec.get('items', [])
        for item in items:
            subsection_bar(str(item.get('number','')) + '  ' + item.get('title',''), story)
            for obs in item.get('observations', []):
                flagged = obs.get('flagged', False)
                txt = obs.get('text','')
                if not txt.startswith('•'): txt = '• ' + txt
                uid = txt[:15].replace(' ','')
                story.append(Paragraph(txt,
                    sty('of'+uid if flagged else 'on'+uid,
                        fontSize=9,
                        textColor=CRITICAL_RED if flagged else DARK_GRAY,
                        fontName='Helvetica-Bold' if flagged else 'Helvetica',
                        leading=13, leftIndent=12)))
            story.append(Spacer(1,6))
            photo_grid(item.get('photos',[]), tmp, story)
            story.append(Spacer(1,8))

        if sec.get('estimatedCost'):
            ct = Table([[
                Paragraph('Estimated Repair Cost for this Section:',
                    sty('cl'+sec.get('title','')[:5], fontSize=9, textColor=MID_GRAY, alignment=TA_RIGHT)),
                Paragraph(sec['estimatedCost'],
                    sty('cv'+sec.get('title','')[:5], fontSize=10, textColor=DARK_BLUE, fontName='Helvetica-Bold')),
            ]], colWidths=[5.2*inch,2.0*inch])
            ct.setStyle(TableStyle([
                ('BACKGROUND',(0,0),(-1,-1),LIGHT_GRAY),
                ('LINEABOVE',(0,0),(-1,0),1,MID_BLUE),
                ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
            ]))
            story.append(ct)
        story.append(Spacer(1,14))

    # SECTION 4: COST SUMMARY
    story.append(PageBreak())
    section_bar('SECTION 4: ESTIMATED REMEDIATION COSTS', story)
    story.append(Spacer(1,8))

    cost_items = data.get('costSummary', [])
    if cost_items:
        th = sty('th', fontSize=9, textColor=WHITE, fontName='Helvetica-Bold')
        rows = [[
            Paragraph('Category', th),
            Paragraph('Description', th),
            Paragraph('Priority', th),
            Paragraph('Estimate', th),
        ]]
        total = 0.0
        rstyles = [('BACKGROUND',(0,0),(-1,0),DARK_BLUE)]
        for i, item in enumerate(cost_items):
            amt = 0.0
            try: amt = float(str(item.get('amount',0)).replace('$','').replace(',',''))
            except: pass
            total += amt
            sev = item.get('priority','MODERATE').upper()
            sc  = SEV_COLORS.get(sev, MID_GRAY)
            bg  = LIGHT_GRAY if i%2==0 else WHITE
            rstyles.append(('BACKGROUND',(0,i+1),(1,i+1),bg))
            rstyles.append(('BACKGROUND',(3,i+1),(3,i+1),bg))
            rstyles.append(('BACKGROUND',(2,i+1),(2,i+1),sc))
            rows.append([
                Paragraph(item.get('category',''),
                    sty('cc'+str(i),fontSize=9,textColor=MID_GRAY,leading=12)),
                Paragraph(item.get('description',''),
                    sty('cd'+str(i),fontSize=9,textColor=DARK_GRAY,leading=12)),
                Paragraph(sev, sty('cp'+str(i),fontSize=8,textColor=WHITE,
                    fontName='Helvetica-Bold',alignment=TA_CENTER)),
                Paragraph('${:,.0f}'.format(amt),
                    sty('ca'+str(i),fontSize=9,textColor=DARK_GRAY,alignment=TA_RIGHT)),
            ])
        ct = Table(rows, colWidths=[1.5*inch,3.5*inch,1.0*inch,1.2*inch])
        ct.setStyle(TableStyle([
            ('GRID',(0,0),(-1,-1),0.25,colors.HexColor('#DDDDDD')),
            ('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),
            ('LEFTPADDING',(0,0),(-1,-1),7),('VALIGN',(0,0),(-1,-1),'TOP'),
            ('ALIGN',(3,0),(3,-1),'RIGHT'),
        ]+rstyles))
        story.append(ct)
        story.append(Spacer(1,6))

        tot = Table([[
            Paragraph('TOTAL ESTIMATED REMEDIATION COST:',
                sty('tl',fontSize=12,textColor=DARK_GRAY,fontName='Helvetica-Bold',alignment=TA_RIGHT)),
            Paragraph('${:,.0f}'.format(total),
                sty('tv',fontSize=14,textColor=DARK_BLUE,fontName='Helvetica-Bold',alignment=TA_RIGHT)),
        ]], colWidths=[5.2*inch,2.0*inch])
        tot.setStyle(TableStyle([
            ('BACKGROUND',(0,0),(-1,-1),LIGHT_GRAY),
            ('LINEABOVE',(0,0),(-1,0),2,DARK_BLUE),
            ('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),
        ]))
        story.append(tot)

    # DISCLAIMER
    story.append(Spacer(1,20))
    story.append(HRFlowable(width='100%',thickness=0.5,color=colors.HexColor('#DDDDDD'),spaceAfter=8))
    story.append(Paragraph(
        'DISCLAIMER: This report is based on a visual inspection only and does not constitute a warranty or guarantee. '
        'Actual repair costs may vary based on contractor bids, site conditions, hidden damage, and permit requirements. '
        'This document is prepared for due diligence and negotiation purposes only. '
        'A licensed contractor should be consulted before finalizing any repair estimates.',
        sty('disc',fontSize=7,textColor=MID_GRAY,leading=11)))

    doc.build(story)
    return output_path

if __name__ == '__main__':
    data = json.loads(sys.argv[1])
    output_path = sys.argv[2]
    generate_inspection(data, output_path)
    print(json.dumps({'success': True, 'path': output_path}))
