import sys
import json
import urllib.request
import tempfile
import os
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import (SimpleDocTemplate, Table, TableStyle, Paragraph,
    Spacer, HRFlowable, Image, PageBreak, KeepTogether)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_RIGHT, TA_LEFT, TA_CENTER, TA_JUSTIFY
from datetime import datetime

# ── BRAND COLORS ────────────────────────────────────────────────────────────
DARK_BLUE    = colors.HexColor('#1B3A5C')
MID_BLUE     = colors.HexColor('#2B5F8E')
LIGHT_BLUE   = colors.HexColor('#A8C8E0')
ACCENT_BLUE  = colors.HexColor('#6FA3C0')
CRITICAL_RED = colors.HexColor('#C0392B')
MAJOR_ORANGE = colors.HexColor('#E67E22')
MOD_YELLOW   = colors.HexColor('#F39C12')
GREEN        = colors.HexColor('#27AE60')
LIGHT_GRAY   = colors.HexColor('#F5F7FA')
MID_GRAY     = colors.HexColor('#888888')
DARK_GRAY    = colors.HexColor('#333333')
WHITE        = colors.white
BLACK        = colors.black
WARN_BG      = colors.HexColor('#FFF8E1')
WARN_BORDER  = colors.HexColor('#F39C12')
CRIT_BG      = colors.HexColor('#FEF2F2')

SEV_COLORS = {
    'CRITICAL': CRITICAL_RED,
    'MAJOR':    MAJOR_ORANGE,
    'MODERATE': MOD_YELLOW,
    'MINOR':    GREEN,
}

_sty_cache = {}

def clean(text):
    if not text: return ' '
    return str(text).replace('\r\n', ' ').replace('\n', ' ').replace('\r', ' ').strip() or ' '

def sty(name, **kw):
    key = name + str(sorted(kw.items()))
    if key not in _sty_cache:
        _sty_cache[key] = ParagraphStyle(name, **kw)
    return _sty_cache[key]

def dl_image(url, tmp):
    try:
        path = os.path.join(tmp, 'img_' + str(abs(hash(url))) + '.jpg')
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=12) as r:
            open(path, 'wb').write(r.read())
        return path
    except:
        return None

def get_image_path(ph, tmp):
    """Use base64 data if available (pre-downloaded), otherwise fall back to URL download."""
    b64 = ph.get('base64', '')
    url = ph.get('url', '')
    cap = ph.get('caption', '')
    if b64:
        try:
            import base64 as b64mod
            ext = 'jpg'
            mt = ph.get('mediaType', 'image/jpeg')
            if 'png' in mt: ext = 'png'
            elif 'gif' in mt: ext = 'gif'
            path = os.path.join(tmp, 'img_' + str(abs(hash(b64[:32]))) + '.' + ext)
            open(path, 'wb').write(b64mod.b64decode(b64))
            return path, cap
        except:
            pass
    if url:
        ip = dl_image(url, tmp)
        if ip: return ip, cap
    return None, cap

def photo_grid(photos, tmp, cols=2):
    if not photos: return []
    elements = []
    paths = []
    for ph in photos[:16]:
        ip, cap = get_image_path(ph, tmp)
        if ip: paths.append((ip, cap))
    for i in range(0, len(paths), cols):
        row = []
        for j in range(cols):
            if i+j < len(paths):
                ip, cap = paths[i+j]
                try:
                    img = Image(ip, width=3.2*inch, height=2.2*inch)
                    cp = Paragraph(clean(cap), sty('cap_'+str(i+j), fontSize=7,
                         textColor=MID_GRAY, leading=10, alignment=TA_CENTER))
                    row.append([img, Spacer(1,3), cp])
                except:
                    row.append([Paragraph('(photo unavailable)',
                                sty('na_'+str(i+j), fontSize=8, textColor=MID_GRAY))])
            else:
                row.append([Paragraph(' ', sty('empty_'+str(i+j), fontSize=8))])
        pt = Table([row], colWidths=[3.55*inch]*cols)
        pt.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),
            ('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
        elements.append(pt)
    return elements

def section_header(number, title):
    text = str(number) + '. ' + title.upper()
    tbl = Table([[Paragraph(clean(text), sty('sh_'+str(number),
                  fontSize=10, textColor=WHITE, fontName='Helvetica-Bold', leading=13))]],
                colWidths=[7.2*inch])
    tbl.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(-1,-1),DARK_BLUE),
        ('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),
        ('LEFTPADDING',(0,0),(-1,-1),12),
    ]))
    return tbl

def subsection_header(title):
    tbl = Table([[Paragraph(clean(title), sty('ssh_'+title[:12],
                  fontSize=9, textColor=WHITE, fontName='Helvetica-Bold'))]],
                colWidths=[7.2*inch])
    tbl.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(-1,-1),MID_BLUE),
        ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
        ('LEFTPADDING',(0,0),(-1,-1),12),
    ]))
    return tbl

def critical_box(text, box_type='CRITICAL'):
    icon = '⚠' if box_type == 'CRITICAL' else '◆'
    bg   = CRIT_BG if box_type == 'CRITICAL' else WARN_BG
    bc   = CRITICAL_RED if box_type == 'CRITICAL' else WARN_BORDER
    tc   = CRITICAL_RED if box_type == 'CRITICAL' else colors.HexColor('#7D5A00')
    full = icon + ' ' + box_type + '  ' + clean(text)
    tbl = Table([[Paragraph(full, sty('cb_'+text[:10], fontSize=9,
                  textColor=tc, fontName='Helvetica-Bold', leading=13))]],
                colWidths=[7.2*inch])
    tbl.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(-1,-1),bg),
        ('BOX',(0,0),(-1,-1),1,bc),
        ('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),
        ('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),
    ]))
    return tbl

def money(v):
    try:
        return '${:,.0f}'.format(float(str(v).replace('$','').replace(',','')))
    except:
        return str(v)

def generate_report(data, output_path):
    doc = SimpleDocTemplate(output_path, pagesize=letter,
        rightMargin=0.7*inch, leftMargin=0.7*inch,
        topMargin=0.7*inch, bottomMargin=0.7*inch)
    story = []
    tmp = tempfile.mkdtemp()

    addr = clean(data.get('propertyAddress', 'Property Address'))
    date_str = datetime.now().strftime('%B %d, %Y')

    # ── PAGE HEADER BAND (repeating concept via first-page only) ────────────
    hdr = Table([[
        Paragraph('FLIPUR INC.', sty('hdr1', fontSize=14, textColor=WHITE,
                  fontName='Helvetica-Bold')),
        Paragraph('Inspection Report &amp; Renovation Bid<br/>' + addr + '<br/>' + date_str,
                  sty('hdr2', fontSize=8, textColor=LIGHT_BLUE,
                  alignment=TA_RIGHT, leading=12)),
    ]], colWidths=[3.6*inch, 3.6*inch])
    hdr.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(-1,-1),DARK_BLUE),
        ('TOPPADDING',(0,0),(-1,-1),12),('BOTTOMPADDING',(0,0),(-1,-1),12),
        ('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),
        ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
    ]))
    story.append(hdr)
    story.append(Spacer(1,6))

    # ── TITLE BLOCK ──────────────────────────────────────────────────────────
    title_tbl = Table([[
        Paragraph('INSPECTION REPORT &amp;<br/>RENOVATION BID',
                  sty('title', fontSize=22, textColor=DARK_BLUE,
                  fontName='Helvetica-Bold', leading=26)),
    ],[
        Paragraph(addr + '&nbsp;&nbsp;|&nbsp;&nbsp;' +
                  clean(data.get('propertyType','Single-Family Residence')) +
                  '&nbsp;&nbsp;|&nbsp;&nbsp;Inspection Date: ' +
                  clean(data.get('inspectionDate', date_str)) +
                  '&nbsp;&nbsp;|&nbsp;&nbsp;Prepared: ' + date_str,
                  sty('subtitle', fontSize=8, textColor=MID_GRAY, leading=12)),
    ]], colWidths=[7.2*inch])
    title_tbl.setStyle(TableStyle([
        ('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),
        ('LINEBELOW',(0,1),(-1,1),1.5,DARK_BLUE),
    ]))
    story.append(title_tbl)
    story.append(Spacer(1,10))

    # ── META BADGES ──────────────────────────────────────────────────────────
    meta = [
        ('Inspection Firm', clean(data.get('inspectionFirm','Tri County Inspection & PM'))),
        ('Inspector',       clean(data.get('inspector','Field Inspector'))),
        ('Report #',        clean(data.get('reportNumber','TRI-'+datetime.now().strftime('%Y%m%d')))),
        ('Unpermitted Sqft',clean(data.get('unpermittedSqft','None identified'))),
    ]
    meta_cells = [[Paragraph(k, sty('mk'+k[:4], fontSize=7, textColor=MID_GRAY, leading=10)),
                   Paragraph(v, sty('mv'+k[:4], fontSize=9, textColor=DARK_BLUE,
                   fontName='Helvetica-Bold', leading=12))] for k,v in meta]
    # 2x2 grid
    badge_row = []
    for i in range(0, len(meta_cells), 2):
        left  = meta_cells[i]   if i   < len(meta_cells) else ['','']
        right = meta_cells[i+1] if i+1 < len(meta_cells) else ['','']
        badge_row.append([
            Table([[left[0]],[left[1]]],  colWidths=[1.8*inch]),
            Table([[right[0]],[right[1]]], colWidths=[1.8*inch]),
        ])
    if badge_row:
        bt = Table(badge_row, colWidths=[3.6*inch,3.6*inch])
        bt.setStyle(TableStyle([
            ('BACKGROUND',(0,0),(-1,-1),LIGHT_GRAY),
            ('BOX',(0,0),(-1,-1),0.5,ACCENT_BLUE),
            ('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),
            ('LEFTPADDING',(0,0),(-1,-1),10),
        ]))
        story.append(bt)
        story.append(Spacer(1,14))

    # ── SECTION 1: CRITICAL NOTICE (unpermitted) ─────────────────────────────
    unpermitted = data.get('unpermittedSqft','')
    if unpermitted and unpermitted.lower() not in ['none','none identified','n/a',' ']:
        story.append(section_header(1, 'CRITICAL NOTICE: UNPERMITTED SQUARE FOOTAGE'))
        story.append(Spacer(1,6))
        story.append(critical_box(
            'This property contains approximately ' + clean(unpermitted) +
            ' square feet of unpermitted living area. City approval is required prior to '
            'or concurrent with renovation work. Approval timeline is estimated at 4 to 6 months '
            'and is NOT guaranteed. The City may require significant retrofitting or may deny the '
            'permit entirely. This risk must be factored into all acquisition, renovation, and '
            'disposition timelines.'))
        story.append(Spacer(1,8))
        risks = data.get('unpermittedRisks', [
            'Permit may be denied, requiring demolition of unpermitted structure at buyer\'s expense',
            'Approval process estimated 4-6 months, extending total project timeline to 9-12 months',
            'City may require upgrades to fire, egress, electrical, plumbing to current code',
            'Resale value may be impacted if permit is not obtained prior to listing',
            'Lender requirements for financing the resale may be affected by unpermitted space',
        ])
        for r in risks:
            story.append(Paragraph('• ' + clean(r),
                sty('risk', fontSize=9, textColor=DARK_GRAY, leading=13, leftIndent=16)))
        story.append(Spacer(1,14))
        sec_offset = 1
    else:
        sec_offset = 0

    # ── SECTION 2: PROPERTY OVERVIEW ─────────────────────────────────────────
    story.append(section_header(1 + sec_offset, 'PROPERTY OVERVIEW'))
    story.append(Spacer(1,6))

    overview = data.get('overview', {})
    ov_rows = [
        ['Property Address',      clean(data.get('propertyAddress','N/A'))],
        ['Property Type',         clean(data.get('propertyType','Single-Family Residence'))],
        ['Inspection Type',       clean(overview.get('inspectionType','Standard Home Inspection'))],
        ['Inspection Date',       clean(data.get('inspectionDate', date_str))],
        ['Inspection Firm',       clean(data.get('inspectionFirm','Tri County Inspection & PM'))],
        ['Report Number',         clean(data.get('reportNumber','N/A'))],
        ['Occupancy at Inspection', clean(overview.get('occupancy','N/A'))],
        ['Utilities at Inspection', clean(overview.get('utilities','All ON'))],
        ['Front Door Orientation',  clean(overview.get('frontDoor','N/A'))],
        ['Wall Materials',          clean(overview.get('walls','N/A'))],
        ['Ceiling Materials',       clean(overview.get('ceilings','N/A'))],
        ['Floor Materials',         clean(overview.get('floors','N/A'))],
        ['Window Types',            clean(overview.get('windows','N/A'))],
        ['Main Water Shutoff',      clean(overview.get('waterShutoff','N/A'))],
        ['Main Gas Shutoff',        clean(overview.get('gasShutoff','N/A'))],
        ['Main Electrical Panel',   clean(overview.get('electricalPanel','N/A'))],
    ]
    if unpermitted and unpermitted.lower() not in ['none','none identified','n/a',' ']:
        ov_rows.append(['Unpermitted Area', clean(unpermitted) + ' — requires city approval (4-6 months)'])

    lbl = sty('ovlbl', fontSize=8, textColor=MID_GRAY, leading=12)
    val = sty('ovval', fontSize=9, textColor=DARK_GRAY, fontName='Helvetica-Bold', leading=12)
    ov_cells = [[Paragraph(r[0],lbl), Paragraph(r[1],val)] for r in ov_rows]
    ov_tbl = Table(ov_cells, colWidths=[2.2*inch,5.0*inch])
    ov_tbl.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(-1,-1),LIGHT_GRAY),
        ('GRID',(0,0),(-1,-1),0.25,colors.HexColor('#DDDDDD')),
        ('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4),
        ('LEFTPADDING',(0,0),(-1,-1),8),
    ]))
    story.append(ov_tbl)
    story.append(Spacer(1,14))

    # ── SECTION 3: INSPECTION FINDINGS ───────────────────────────────────────
    story.append(PageBreak())
    story.append(section_header(2 + sec_offset, 'INSPECTION FINDINGS — DETAILED'))
    story.append(Spacer(1,8))

    body = sty('body', fontSize=9, textColor=DARK_GRAY, leading=13, alignment=TA_JUSTIFY)
    bullet = sty('bullet', fontSize=9, textColor=DARK_GRAY, leading=13, leftIndent=14)

    findings_sections = data.get('findingsSections', [])
    for fs in findings_sections:
        story.append(subsection_header(fs.get('title','')))
        story.append(Spacer(1,5))

        intro = clean(fs.get('intro',''))
        if intro and intro != ' ':
            story.append(Paragraph(intro, body))
            story.append(Spacer(1,6))

        for item in fs.get('items', []):
            # Item heading
            item_title = clean(item.get('title',''))
            if item_title and item_title != ' ':
                story.append(Paragraph(item_title,
                    sty('it_'+item_title[:10], fontSize=9, textColor=DARK_BLUE,
                    fontName='Helvetica-Bold', leading=13)))

            item_text = clean(item.get('text',''))
            if item_text and item_text != ' ':
                story.append(Paragraph(item_text, body))

            for obs in item.get('observations', []):
                story.append(Paragraph('• ' + clean(obs),
                    sty('obs_'+obs[:8], fontSize=9, textColor=DARK_GRAY,
                    leading=13, leftIndent=14)))

            for flag in item.get('criticalFlags', []):
                story.append(Spacer(1,3))
                story.append(critical_box(clean(flag), 'CRITICAL'))

            for warn in item.get('attentionFlags', []):
                story.append(Spacer(1,3))
                story.append(critical_box(clean(warn), 'ATTENTION'))

            story.append(Spacer(1,6))

        # Section photos
        sec_photos = fs.get('photos', [])
        if sec_photos:
            story.append(Paragraph('Photographic Documentation',
                sty('phdr', fontSize=9, textColor=MID_BLUE, fontName='Helvetica-Bold')))
            story.append(Spacer(1,4))
            for el in photo_grid(sec_photos, tmp):
                story.append(el)

        story.append(Spacer(1,10))

    # ── SECTION 4: RENOVATION BID ─────────────────────────────────────────────
    story.append(PageBreak())
    story.append(section_header(3 + sec_offset, 'RENOVATION BID — SCOPE OF WORK & COST ESTIMATE'))
    story.append(Spacer(1,6))

    bid_intro = clean(data.get('bidIntro', ''))
    if bid_intro and bid_intro != ' ':
        story.append(Paragraph(bid_intro, body))
        story.append(Spacer(1,8))

    if data.get('unpermittedSqft','').lower() not in ['none','none identified','n/a',' ','']:
        story.append(critical_box(
            'Unpermitted sqft costs (permit fees, engineering, code upgrades) are noted separately '
            'and may not be fully reflected in the base bid. Budget an additional $25,000–$40,000 '
            'contingency for permit-related remediation.', 'ATTENTION'))
        story.append(Spacer(1,8))

    bid_sections = data.get('bidSections', [])
    grand_total = 0.0
    for bs in bid_sections:
        story.append(subsection_header(bs.get('title','')))
        story.append(Spacer(1,4))

        line_items = bs.get('lineItems', [])
        if line_items:
            th = sty('th', fontSize=8, textColor=WHITE, fontName='Helvetica-Bold')
            rows = [[Paragraph('Line Item', th), Paragraph('Est. Cost', th)]]
            subtotal = 0.0
            for li in line_items:
                amt = 0.0
                try: amt = float(str(li.get('amount',0)).replace('$','').replace(',',''))
                except: pass
                subtotal += amt
                grand_total += amt
                rows.append([
                    Paragraph(clean(li.get('description','')),
                        sty('lid'+str(len(rows)), fontSize=9, textColor=DARK_GRAY, leading=12)),
                    Paragraph(money(amt),
                        sty('lia'+str(len(rows)), fontSize=9, textColor=DARK_GRAY,
                        alignment=TA_RIGHT)),
                ])
            rows.append([
                Paragraph('SUBTOTAL — ' + clean(bs.get('shortTitle', bs.get('title',''))),
                    sty('st'+bs.get('title','')[:6], fontSize=9, textColor=DARK_BLUE,
                    fontName='Helvetica-Bold')),
                Paragraph(money(subtotal),
                    sty('sta'+bs.get('title','')[:6], fontSize=10, textColor=DARK_BLUE,
                    fontName='Helvetica-Bold', alignment=TA_RIGHT)),
            ])
            li_tbl = Table(rows, colWidths=[5.7*inch,1.5*inch])
            row_styles = [
                ('BACKGROUND',(0,0),(-1,0),MID_BLUE),
                ('BACKGROUND',(0,-1),(-1,-1),LIGHT_GRAY),
                ('LINEABOVE',(0,-1),(-1,-1),1,MID_BLUE),
                ('GRID',(0,0),(-1,-1),0.25,colors.HexColor('#DDDDDD')),
                ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
                ('LEFTPADDING',(0,0),(-1,-1),8),('ALIGN',(1,0),(1,-1),'RIGHT'),
                ('VALIGN',(0,0),(-1,-1),'TOP'),
            ]
            for i in range(1, len(rows)-1):
                if i % 2 == 0:
                    row_styles.append(('BACKGROUND',(0,i),(0,i),LIGHT_GRAY))
                    row_styles.append(('BACKGROUND',(1,i),(1,i),LIGHT_GRAY))
            li_tbl.setStyle(TableStyle(row_styles))
            story.append(li_tbl)
        story.append(Spacer(1,10))

    # ── SECTION 5: BID SUMMARY ────────────────────────────────────────────────
    story.append(PageBreak())
    story.append(section_header(4 + sec_offset, 'BID SUMMARY & PROJECT FINANCIALS'))
    story.append(Spacer(1,8))

    story.append(Paragraph('5.1 Renovation Bid Summary',
        sty('s51', fontSize=11, textColor=DARK_BLUE, fontName='Helvetica-Bold')))
    story.append(Spacer(1,5))

    # Summary table
    sum_th = sty('sumth', fontSize=9, textColor=WHITE, fontName='Helvetica-Bold')
    sum_rows = [[Paragraph('Scope Category', sum_th), Paragraph('Estimated Cost', sum_th)]]
    for bs in bid_sections:
        subtotal = sum(float(str(li.get('amount',0)).replace('$','').replace(',',''))
                       for li in bs.get('lineItems',[]) if li.get('amount'))
        sum_rows.append([
            Paragraph(clean(bs.get('title','')),
                sty('sums'+bs.get('title','')[:6], fontSize=9, textColor=DARK_GRAY, leading=12)),
            Paragraph(money(subtotal),
                sty('suma'+bs.get('title','')[:6], fontSize=9, textColor=DARK_GRAY,
                alignment=TA_RIGHT)),
        ])

    target_budget = data.get('targetBudget', 0)
    try: target_budget = float(str(target_budget).replace('$','').replace(',',''))
    except: target_budget = grand_total

    sum_rows.append([
        Paragraph('TOTAL RENOVATION BID',
            sty('tot1', fontSize=10, textColor=DARK_BLUE, fontName='Helvetica-Bold')),
        Paragraph(money(grand_total),
            sty('tot1a', fontSize=10, textColor=DARK_BLUE, fontName='Helvetica-Bold',
            alignment=TA_RIGHT)),
    ])
    if target_budget and target_budget != grand_total:
        reduction = grand_total - target_budget
        sum_rows.append([
            Paragraph('Less Contingency Reduction to Target',
                sty('red1', fontSize=9, textColor=MID_GRAY)),
            Paragraph('(' + money(reduction) + ')',
                sty('red1a', fontSize=9, textColor=MID_GRAY, alignment=TA_RIGHT)),
        ])
        sum_rows.append([
            Paragraph('TARGET RENOVATION BUDGET',
                sty('tgt1', fontSize=10, textColor=DARK_BLUE, fontName='Helvetica-Bold')),
            Paragraph(money(target_budget),
                sty('tgt1a', fontSize=11, textColor=DARK_BLUE, fontName='Helvetica-Bold',
                alignment=TA_RIGHT)),
        ])

    sum_tbl = Table(sum_rows, colWidths=[5.7*inch,1.5*inch])
    sum_styles = [
        ('BACKGROUND',(0,0),(-1,0),DARK_BLUE),
        ('GRID',(0,0),(-1,-1),0.25,colors.HexColor('#DDDDDD')),
        ('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),
        ('LEFTPADDING',(0,0),(-1,-1),8),('ALIGN',(1,0),(1,-1),'RIGHT'),
        ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
        ('LINEABOVE',(0,-1),(-1,-1),1.5,DARK_BLUE),
        ('BACKGROUND',(0,-1),(-1,-1),LIGHT_GRAY),
    ]
    for i in range(1, len(sum_rows)-1):
        if i % 2 == 0:
            sum_styles.append(('BACKGROUND',(0,i),(-1,i),LIGHT_GRAY))
    sum_tbl.setStyle(TableStyle(sum_styles))
    story.append(sum_tbl)
    story.append(Spacer(1,14))

    # ── PROJECT FINANCIALS ────────────────────────────────────────────────────
    financials = data.get('financials', {})
    arv = 0.0
    try: arv = float(str(financials.get('arv',0)).replace('$','').replace(',',''))
    except: pass

    if arv > 0:
        story.append(Paragraph('5.2 Project Financial Summary',
            sty('s52', fontSize=11, textColor=DARK_BLUE, fontName='Helvetica-Bold')))
        story.append(Spacer(1,5))

        reno = target_budget if target_budget else grand_total
        hold_months = financials.get('holdMonths', 9)
        try: hold_months = int(hold_months)
        except: hold_months = 9

        carry = financials.get('carryCosts', 0)
        try: carry = float(str(carry).replace('$','').replace(',',''))
        except: carry = 0

        commission = financials.get('agentCommission', 0)
        try: commission = float(str(commission).replace('$','').replace(',',''))
        except: commission = round(arv * 0.03, 0)

        taxes_closing = financials.get('taxesClosing', 0)
        try: taxes_closing = float(str(taxes_closing).replace('$','').replace(',',''))
        except: taxes_closing = round(arv * 0.01, 0)

        insurance = financials.get('insurance', 4800)
        try: insurance = float(str(insurance).replace('$','').replace(',',''))
        except: insurance = 4800

        total_costs = reno + carry + commission + taxes_closing + insurance
        net_before_acq = arv - total_costs

        fin_rows = [
            ['Projected Resale After Renovations', money(arv)],
            ['Total Renovation Budget', money(reno)],
            ['Carry Costs — ' + str(hold_months) + ' Months', money(carry)],
            ['Agent Commission at Close', money(commission)],
            ['Transfer Taxes, Property Taxes & Closing Costs', money(taxes_closing)],
            ['Insurance (renovation period)', money(insurance)],
            ['TOTAL PROJECTED COSTS (excl. acquisition)', money(total_costs)],
            ['Net Profit Before Acquisition Cost', money(net_before_acq)],
        ]
        fin_lbl = sty('finlbl', fontSize=9, textColor=DARK_GRAY, leading=12)
        fin_val = sty('finval', fontSize=9, textColor=DARK_GRAY, leading=12, alignment=TA_RIGHT)
        fin_tbl = Table([[Paragraph(r[0],fin_lbl), Paragraph(r[1],fin_val)] for r in fin_rows],
                        colWidths=[5.7*inch,1.5*inch])
        fin_styles = [
            ('GRID',(0,0),(-1,-1),0.25,colors.HexColor('#DDDDDD')),
            ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
            ('LEFTPADDING',(0,0),(-1,-1),8),('ALIGN',(1,0),(1,-1),'RIGHT'),
            ('BACKGROUND',(0,-1),(-1,-1),LIGHT_GRAY),
            ('BACKGROUND',(0,-2),(-1,-2),colors.HexColor('#EEF4FB')),
            ('FONTNAME',(0,-1),(-1,-1),'Helvetica-Bold'),
            ('FONTNAME',(0,-2),(-1,-2),'Helvetica-Bold'),
            ('TEXTCOLOR',(0,-1),(-1,-1),DARK_BLUE),
            ('TEXTCOLOR',(0,-2),(-1,-2),DARK_BLUE),
            ('LINEABOVE',(0,-2),(-1,-2),1,MID_BLUE),
        ]
        for i in range(len(fin_rows)):
            if i % 2 == 0 and i < len(fin_rows)-2:
                fin_styles.append(('BACKGROUND',(0,i),(-1,i),LIGHT_GRAY))
        fin_tbl.setStyle(TableStyle(fin_styles))
        story.append(fin_tbl)
        story.append(Spacer(1,14))

        # MAO
        story.append(Paragraph('5.3 Suggested Purchase Price & Value Analysis',
            sty('s53', fontSize=11, textColor=DARK_BLUE, fontName='Helvetica-Bold')))
        story.append(Spacer(1,5))

        target_profit = financials.get('targetProfit', 80000)
        try: target_profit = float(str(target_profit).replace('$','').replace(',',''))
        except: target_profit = 80000

        mao = arv - reno - carry - commission - taxes_closing - insurance - target_profit
        offer_low  = round(mao * 0.93, -3)
        offer_high = round(mao * 0.97, -3)

        mao_intro = (
            'The following analysis derives a maximum allowable offer (MAO) based on a target '
            'net profit of ' + money(target_profit) + ' to Flipur Inc. after all renovation, '
            'carry, disposition, and holding costs are deducted from projected resale.'
        )
        story.append(Paragraph(mao_intro, body))
        story.append(Spacer(1,6))

        mao_rows = [
            ['Purchase Price Derivation (Base Case)', 'Amount'],
            ['Projected Resale (mid-point)', money(arv)],
            ['Less: Renovation Budget', '(' + money(reno) + ')'],
            ['Less: Carry Costs — ' + str(hold_months) + ' months', '(' + money(carry) + ')'],
            ['Less: Agent Commission', '(' + money(commission) + ')'],
            ['Less: Transfer Taxes, Taxes & Closing Costs', '(' + money(taxes_closing) + ')'],
            ['Less: Insurance', '(' + money(insurance) + ')'],
            ['Less: Target Net Profit', '(' + money(target_profit) + ')'],
            ['SUGGESTED MAXIMUM PURCHASE PRICE', money(mao)],
        ]
        mao_lbl = sty('maolbl', fontSize=9, textColor=DARK_GRAY, leading=12)
        mao_val = sty('maoval', fontSize=9, textColor=DARK_GRAY, leading=12, alignment=TA_RIGHT)
        mao_th  = sty('maoth',  fontSize=9, textColor=WHITE, fontName='Helvetica-Bold')
        mao_cells = []
        for i, r in enumerate(mao_rows):
            if i == 0:
                mao_cells.append([Paragraph(r[0],mao_th), Paragraph(r[1],mao_th)])
            elif i == len(mao_rows)-1:
                mao_cells.append([
                    Paragraph(r[0], sty('maofin', fontSize=10, textColor=DARK_BLUE,
                              fontName='Helvetica-Bold')),
                    Paragraph(r[1], sty('maofinv', fontSize=11, textColor=DARK_BLUE,
                              fontName='Helvetica-Bold', alignment=TA_RIGHT)),
                ])
            else:
                mao_cells.append([Paragraph(r[0],mao_lbl), Paragraph(r[1],mao_val)])

        mao_tbl = Table(mao_cells, colWidths=[5.7*inch,1.5*inch])
        mao_tbl.setStyle(TableStyle([
            ('BACKGROUND',(0,0),(-1,0),DARK_BLUE),
            ('BACKGROUND',(0,-1),(-1,-1),LIGHT_GRAY),
            ('LINEABOVE',(0,-1),(-1,-1),1.5,DARK_BLUE),
            ('GRID',(0,0),(-1,-1),0.25,colors.HexColor('#DDDDDD')),
            ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
            ('LEFTPADDING',(0,0),(-1,-1),8),('ALIGN',(1,0),(1,-1),'RIGHT'),
        ]))
        story.append(mao_tbl)
        story.append(Spacer(1,6))

        story.append(critical_box(
            'At a purchase price at or below ' + money(offer_high) +
            ', this deal produces the ' + money(target_profit) +
            ' target profit. Flipur Inc. should target an offer in the ' +
            money(offer_low) + '–' + money(offer_high) +
            ' range to provide negotiating buffer and downside protection.', 'ATTENTION'))
        story.append(Spacer(1,14))

        # Scenario table
        scenarios = data.get('scenarios', [])
        if scenarios:
            story.append(Paragraph('Scenario Analysis',
                sty('scen', fontSize=10, textColor=DARK_BLUE, fontName='Helvetica-Bold')))
            story.append(Spacer(1,5))
            sc_th = sty('scth', fontSize=8, textColor=WHITE, fontName='Helvetica-Bold')
            sc_rows = [[Paragraph(h,sc_th) for h in ['Scenario','Resale','@ MAO Buy','@ Target Buy']]]
            for sc in scenarios:
                sc_rows.append([
                    Paragraph(clean(sc.get('name','')),
                        sty('scn'+sc.get('name','')[:6], fontSize=8, textColor=DARK_GRAY, leading=12)),
                    Paragraph(clean(sc.get('resale','')),
                        sty('scr'+sc.get('name','')[:6], fontSize=8, textColor=DARK_GRAY,
                        alignment=TA_RIGHT)),
                    Paragraph(clean(sc.get('maoProfit','')),
                        sty('scm'+sc.get('name','')[:6], fontSize=8, textColor=DARK_GRAY,
                        alignment=TA_RIGHT)),
                    Paragraph(clean(sc.get('targetProfit','')),
                        sty('sct'+sc.get('name','')[:6], fontSize=8, textColor=DARK_GRAY,
                        alignment=TA_RIGHT)),
                ])
            sc_tbl = Table(sc_rows, colWidths=[2.8*inch,1.5*inch,1.45*inch,1.45*inch])
            sc_tbl.setStyle(TableStyle([
                ('BACKGROUND',(0,0),(-1,0),MID_BLUE),
                ('GRID',(0,0),(-1,-1),0.25,colors.HexColor('#DDDDDD')),
                ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
                ('LEFTPADDING',(0,0),(-1,-1),8),('ALIGN',(1,0),(-1,-1),'RIGHT'),
            ]))
            story.append(sc_tbl)
            story.append(Spacer(1,14))

        # Risk matrix
        risks_matrix = data.get('riskMatrix', [])
        if risks_matrix:
            story.append(Paragraph('Risk Assessment Matrix',
                sty('risk_hdr', fontSize=10, textColor=DARK_BLUE, fontName='Helvetica-Bold')))
            story.append(Spacer(1,5))
            rm_th = sty('rmth', fontSize=8, textColor=WHITE, fontName='Helvetica-Bold')
            rm_rows = [[Paragraph(h,rm_th) for h in ['Risk Factor','Likelihood','Impact','Rating']]]
            for rm in risks_matrix:
                rating = clean(rm.get('rating','MEDIUM')).upper()
                rc2 = CRITICAL_RED if rating=='HIGH' else (MOD_YELLOW if rating=='MEDIUM' else GREEN)
                rm_rows.append([
                    Paragraph(clean(rm.get('factor','')),
                        sty('rmf'+rm.get('factor','')[:6], fontSize=8, textColor=DARK_GRAY, leading=12)),
                    Paragraph(clean(rm.get('likelihood','')),
                        sty('rml'+rm.get('factor','')[:6], fontSize=8, textColor=DARK_GRAY)),
                    Paragraph(clean(rm.get('impact','')),
                        sty('rmi'+rm.get('factor','')[:6], fontSize=8, textColor=DARK_GRAY)),
                    Paragraph(rating,
                        sty('rmr'+rm.get('factor','')[:6], fontSize=8, textColor=WHITE,
                        fontName='Helvetica-Bold', alignment=TA_CENTER)),
                ])
            rm_tbl = Table(rm_rows, colWidths=[3.4*inch,1.2*inch,1.2*inch,1.4*inch])
            rm_styles = [
                ('BACKGROUND',(0,0),(-1,0),DARK_BLUE),
                ('GRID',(0,0),(-1,-1),0.25,colors.HexColor('#DDDDDD')),
                ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
                ('LEFTPADDING',(0,0),(-1,-1),8),
            ]
            for i in range(1, len(rm_rows)):
                rating = rm_rows[i][3].text if hasattr(rm_rows[i][3],'text') else 'MEDIUM'
                rc2 = CRITICAL_RED if 'HIGH' in str(rating) else (MOD_YELLOW if 'MED' in str(rating) else GREEN)
                rm_styles.append(('BACKGROUND',(3,i),(3,i),rc2))
                if i % 2 == 0:
                    rm_styles.append(('BACKGROUND',(0,i),(2,i),LIGHT_GRAY))
            rm_tbl.setStyle(TableStyle(rm_styles))
            story.append(rm_tbl)
            story.append(Spacer(1,14))

    # ── TIMELINE ──────────────────────────────────────────────────────────────
    timeline = data.get('timeline', [])
    if timeline:
        story.append(Paragraph('Project Timeline',
            sty('tl_hdr', fontSize=10, textColor=DARK_BLUE, fontName='Helvetica-Bold')))
        story.append(Spacer(1,5))
        tl_th = sty('tlth', fontSize=9, textColor=WHITE, fontName='Helvetica-Bold')
        tl_rows = [[Paragraph('Phase',tl_th), Paragraph('Estimated Duration',tl_th)]]
        for tl in timeline:
            tl_rows.append([
                Paragraph(clean(tl.get('phase','')),
                    sty('tlp'+tl.get('phase','')[:6], fontSize=9, textColor=DARK_GRAY, leading=12)),
                Paragraph(clean(tl.get('duration','')),
                    sty('tld'+tl.get('phase','')[:6], fontSize=9, textColor=DARK_GRAY)),
            ])
        # Total
        total_tl = clean(data.get('totalTimeline',''))
        if total_tl and total_tl != ' ':
            tl_rows.append([
                Paragraph('TOTAL ESTIMATED TIMELINE',
                    sty('tltot', fontSize=9, textColor=DARK_BLUE, fontName='Helvetica-Bold')),
                Paragraph(total_tl,
                    sty('tltotv', fontSize=9, textColor=DARK_BLUE, fontName='Helvetica-Bold')),
            ])
        tl_tbl = Table(tl_rows, colWidths=[4.0*inch,3.2*inch])
        tl_tbl.setStyle(TableStyle([
            ('BACKGROUND',(0,0),(-1,0),MID_BLUE),
            ('BACKGROUND',(0,-1),(-1,-1),LIGHT_GRAY),
            ('GRID',(0,0),(-1,-1),0.25,colors.HexColor('#DDDDDD')),
            ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
            ('LEFTPADDING',(0,0),(-1,-1),8),
        ]))
        story.append(tl_tbl)
        story.append(Spacer(1,14))

    # ── DISCLAIMERS ───────────────────────────────────────────────────────────
    story.append(section_header(5 + sec_offset, 'DISCLAIMERS & CONDITIONS'))
    story.append(Spacer(1,6))
    disclaimers = data.get('disclaimers', [
        'All cost estimates are preliminary and subject to change upon contractor walkthrough, '
        'final scope confirmation, and current market pricing.',
        'Hidden conditions behind walls, under floors, or in inaccessible areas may result in '
        'additional scope and costs.',
        'This document is confidential and intended solely for use by Flipur Inc. and its principals '
        'for internal investment analysis purposes.',
        'Projected resale values are estimates based on current comparable sales and are not guaranteed.',
        'Flipur Inc. is not responsible for conditions not identified or accessible at the time of '
        'the third-party home inspection.',
    ])
    for d in disclaimers:
        story.append(Paragraph('• ' + clean(d),
            sty('disc'+d[:8], fontSize=9, textColor=DARK_GRAY, leading=13, leftIndent=14)))
    story.append(Spacer(1,14))

    # ── FOOTER ────────────────────────────────────────────────────────────────
    story.append(HRFlowable(width='100%',thickness=0.5,
        color=colors.HexColor('#DDDDDD'),spaceAfter=6))
    story.append(Paragraph(
        'Flipur Inc. | Flipur Companies | Huntington Beach, CA | Confidential &amp; Proprietary | '
        'Report Prepared: ' + date_str,
        sty('footer', fontSize=7, textColor=MID_GRAY, alignment=TA_CENTER)))

    doc.build(story)
    return output_path

if __name__ == '__main__':
    data = json.loads(sys.argv[1])
    output_path = sys.argv[2]
    generate_report(data, output_path)
    print(json.dumps({'success': True, 'path': output_path}))
