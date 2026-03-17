import sys
import json
import urllib.request
import tempfile
import os
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable, Image
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_RIGHT, TA_LEFT, TA_CENTER
from datetime import datetime

DARK_BLUE = colors.HexColor('#1B3A5C')
MID_BLUE = colors.HexColor('#2B5F8E')
MID_GRAY = colors.HexColor('#888888')
DARK_GRAY = colors.HexColor('#333333')
WHITE = colors.white

CATEGORIES = {
    "roof": "Roof",
    "foundation": "Foundation / Structural",
    "electrical": "Electrical",
    "plumbing": "Plumbing",
    "hvac": "HVAC",
    "interior": "Interior (Paint, Flooring, Drywall)",
    "kitchen": "Kitchen",
    "bathrooms": "Bathrooms",
    "windows_doors": "Windows / Doors",
    "landscaping": "Landscaping / Exterior",
    "termite": "Termite / Pest",
    "mold": "Mold / Remediation",
    "other": "Other / Miscellaneous",
}

def format_currency(amount):
    try:
        return "${:,.2f}".format(float(str(amount).replace('$','').replace(',','')))
    except:
        return str(amount)

def download_image(url, tmp_dir):
    try:
        path = os.path.join(tmp_dir, "photo_" + str(abs(hash(url))) + ".jpg")
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            with open(path, 'wb') as f:
                f.write(resp.read())
        return path
    except Exception as e:
        print("Failed to download image:", str(e))
        return None

def generate_bid(data, output_path):
    doc = SimpleDocTemplate(output_path, pagesize=letter,
        rightMargin=0.65*inch, leftMargin=0.65*inch,
        topMargin=0.65*inch, bottomMargin=0.65*inch)

    story = []
    tmp_dir = tempfile.mkdtemp()
    photo_paths = []

    # HEADER
    header_data = [[
        Paragraph('TRI COUNTY<br/>INSPECTION AND PROJECT MANAGEMENT',
            ParagraphStyle('co', fontSize=16, textColor=DARK_BLUE, fontName='Helvetica-Bold', leading=20)),
        Paragraph('REPAIR ESTIMATE',
            ParagraphStyle('title', fontSize=26, textColor=DARK_BLUE, fontName='Helvetica-Bold', alignment=TA_RIGHT))
    ]]
    header_table = Table(header_data, colWidths=[3.5*inch, 3.5*inch])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('ALIGN', (1,0), (1,0), 'RIGHT'),
        ('TOPPADDING', (0,0), (-1,-1), 0),
        ('BOTTOMPADDING', (0,0), (-1,-1), 0),
    ]))
    story.append(header_table)
    story.append(HRFlowable(width="100%", thickness=2, color=MID_BLUE, spaceAfter=12))

    # PROPERTY INFO
    date_str = datetime.now().strftime('%B %d, %Y')
    prop_style = ParagraphStyle('prop', fontSize=9, textColor=MID_GRAY, leading=14)
    prop_val = ParagraphStyle('propval', fontSize=10, textColor=DARK_GRAY, fontName='Helvetica-Bold', leading=14)

    info_left = [
        Paragraph('Property Address', prop_style),
        Paragraph(data.get('propertyAddress', 'N/A'), prop_val),
        Spacer(1, 6),
        Paragraph('Prepared For', prop_style),
        Paragraph(data.get('preparedFor', 'Flipur Companies'), prop_val),
    ]
    info_right = [
        Paragraph('Date', prop_style),
        Paragraph(date_str, prop_val),
        Spacer(1, 6),
        Paragraph('Report Reference', prop_style),
        Paragraph(data.get('reportRef', 'Field Inspection'), prop_val),
    ]
    story.append(Table([[info_left, info_right]], colWidths=[3.5*inch, 3.5*inch],
        style=[('VALIGN', (0,0), (-1,-1), 'TOP')]))
    story.append(Spacer(1, 16))

    # PURPOSE
    story.append(Paragraph(
        'The following repair estimate has been prepared based on a field inspection of the above-referenced property. '
        'All items listed represent deficiencies, deferred maintenance, or code concerns identified during the inspection. '
        'Estimates reflect current California contractor rates.',
        ParagraphStyle('note', fontSize=9, textColor=MID_GRAY, leading=13)))
    story.append(Spacer(1, 16))

    # LINE ITEMS
    th = ParagraphStyle('th', fontSize=9, textColor=WHITE, fontName='Helvetica-Bold')
    td_cat = ParagraphStyle('tdc', fontSize=8, textColor=MID_GRAY, leading=12)
    td_left = ParagraphStyle('tdl', fontSize=9, textColor=DARK_GRAY, leading=13)
    td_right = ParagraphStyle('tdr', fontSize=9, textColor=DARK_GRAY, alignment=TA_RIGHT)

    table_data = [[
        Paragraph('Category', th),
        Paragraph('Description', th),
        Paragraph('Estimate', th),
    ]]

    line_items = data.get('lineItems', [])
    total = 0.0

    for i, item in enumerate(line_items):
        cat_label = CATEGORIES.get(item.get('category', 'other'), item.get('category', 'Other'))
        desc = item.get('description', '')
        amount = float(str(item.get('amount', 0)).replace('$','').replace(',',''))
        total += amount
        table_data.append([
            Paragraph(cat_label, td_cat),
            Paragraph(desc, td_left),
            Paragraph(format_currency(amount), td_right),
        ])

    for _ in range(max(0, 3 - len(line_items))):
        table_data.append(['', '', ''])

    row_colors = [('BACKGROUND', (0,i), (-1,i),
        WHITE if i % 2 != 0 else colors.HexColor('#F0F4F8'))
        for i in range(1, len(table_data))]

    items_table = Table(table_data, colWidths=[1.6*inch, 4.4*inch, 1.2*inch])
    items_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), DARK_BLUE),
        ('GRID', (0,0), (-1,-1), 0.25, colors.HexColor('#DDDDDD')),
        ('TOPPADDING', (0,0), (-1,-1), 7),
        ('BOTTOMPADDING', (0,0), (-1,-1), 7),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ] + row_colors))
    story.append(items_table)
    story.append(Spacer(1, 8))

    # TOTALS
    meta_label = ParagraphStyle('ml', fontSize=10, textColor=MID_GRAY, alignment=TA_RIGHT)
    meta_val = ParagraphStyle('mv', fontSize=10, textColor=DARK_GRAY, alignment=TA_RIGHT)
    total_label = ParagraphStyle('tl', fontSize=12, textColor=DARK_GRAY, fontName='Helvetica-Bold', alignment=TA_RIGHT)
    total_val = ParagraphStyle('tv', fontSize=13, textColor=DARK_BLUE, fontName='Helvetica-Bold', alignment=TA_RIGHT)

    totals_data = [
        ['', Paragraph('Subtotal:', meta_label), Paragraph(format_currency(total), meta_val)],
        ['', Paragraph('TOTAL ESTIMATED REPAIRS:', total_label), Paragraph(format_currency(total), total_val)],
    ]
    totals_table = Table(totals_data, colWidths=[2.8*inch, 2.8*inch, 1.6*inch])
    totals_table.setStyle(TableStyle([
        ('ALIGN', (1,0), (-1,-1), 'RIGHT'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('LINEABOVE', (1,1), (-1,1), 1.5, DARK_BLUE),
    ]))
    story.append(totals_table)

    # NOTES
    notes = data.get('notes', '')
    if notes:
        story.append(Spacer(1, 16))
        story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor('#DDDDDD'), spaceAfter=8))
        story.append(Paragraph('Notes:', ParagraphStyle('noteslabel', fontSize=8, textColor=MID_GRAY)))
        story.append(Paragraph(notes, ParagraphStyle('notesval', fontSize=9, textColor=DARK_GRAY, leading=13)))

    # PHOTOS
    photos = data.get('photos', [])
    if photos:
        story.append(Spacer(1, 20))
        story.append(HRFlowable(width="100%", thickness=1, color=MID_BLUE, spaceAfter=10))
        story.append(Paragraph('INSPECTION PHOTOS',
            ParagraphStyle('photohdr', fontSize=12, textColor=DARK_BLUE, fontName='Helvetica-Bold')))
        story.append(Spacer(1, 10))

        for p in photos[:12]:
            url = p.get('url', '')
            caption = p.get('caption', '')
            if url:
                path = download_image(url, tmp_dir)
                if path:
                    photo_paths.append((path, caption))

        for i in range(0, len(photo_paths), 2):
            row = []
            for j in range(2):
                if i + j < len(photo_paths):
                    path, caption = photo_paths[i + j]
                    try:
                        img = Image(path, width=3.2*inch, height=2.2*inch)
                        cap_p = Paragraph(caption, ParagraphStyle('cap', fontSize=7, textColor=MID_GRAY, leading=10))
                        cell = [img, Spacer(1, 3), cap_p]
                    except:
                        cell = [Paragraph('(photo unavailable)', ParagraphStyle('na', fontSize=8, textColor=MID_GRAY))]
                else:
                    cell = ['']
                row.append(cell)
            photo_table = Table([row], colWidths=[3.35*inch, 3.35*inch])
            photo_table.setStyle(TableStyle([
                ('VALIGN', (0,0), (-1,-1), 'TOP'),
                ('TOPPADDING', (0,0), (-1,-1), 4),
                ('BOTTOMPADDING', (0,0), (-1,-1), 8),
            ]))
            story.append(photo_table)

    # DISCLAIMER
    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor('#DDDDDD'), spaceAfter=8))
    story.append(Paragraph(
        'DISCLAIMER: This estimate is based on a visual inspection only and is not a guarantee of final contractor pricing. '
        'Actual costs may vary based on contractor bids, site conditions, and permit requirements. '
        'This document is prepared for negotiation purposes only.',
        ParagraphStyle('disc', fontSize=7, textColor=MID_GRAY, leading=11)))

    doc.build(story)

    for path, _ in photo_paths:
        try:
            os.remove(path)
        except:
            pass

    return output_path

if __name__ == "__main__":
    data = json.loads(sys.argv[1])
    output_path = sys.argv[2]
    generate_bid(data, output_path)
    print(json.dumps({"success": True, "path": output_path}))
