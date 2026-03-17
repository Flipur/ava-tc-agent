import sys
import json
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_RIGHT, TA_LEFT, TA_CENTER
from datetime import datetime

NAVY = colors.HexColor('#1B3A5C')
STEEL = colors.HexColor('#2B5F8E')
LIGHT_BLUE = colors.HexColor('#A8C8E0')
LIGHT_GRAY = colors.HexColor('#F5F7FA')
MID_GRAY = colors.HexColor('#888888')
DARK_GRAY = colors.HexColor('#333333')

def format_currency(amount):
    try:
        return "${:,.2f}".format(float(str(amount).replace('$','').replace(',','')))
    except:
        return str(amount)

def generate_escrow_invoice(data, output_path):
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        rightMargin=0.6*inch,
        leftMargin=0.6*inch,
        topMargin=0.6*inch,
        bottomMargin=0.6*inch
    )

    story = []

    # --- HEADER ---
    header_data = [
        [
            Paragraph('<font color="#1B3A5C"><b>FLIPUR</b></font>',
                      ParagraphStyle('logo', fontSize=22, textColor=NAVY, fontName='Helvetica-Bold')),
            Paragraph('INVOICE',
                      ParagraphStyle('inv', fontSize=32, textColor=NAVY, fontName='Helvetica-Bold', alignment=TA_RIGHT))
        ],
        [
            Paragraph('Flipur, Inc<br/>17011 Beach Blvd., Suite 550<br/>Huntington Beach, CA 92647',
                      ParagraphStyle('addr', fontSize=9, textColor=DARK_GRAY, leading=14)),
            Paragraph(f'# {data["invoiceNumber"]}',
                      ParagraphStyle('invnum', fontSize=11, textColor=STEEL, alignment=TA_RIGHT, fontName='Helvetica'))
        ]
    ]
    header_table = Table(header_data, colWidths=[3.5*inch, 3.5*inch], rowHeights=[0.55*inch, None])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('ALIGN', (1,0), (1,-1), 'RIGHT'),
        ('TOPPADDING', (0,0), (-1,-1), 0),
        ('BOTTOMPADDING', (0,0), (-1,-1), 2),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 20))

    # --- BILL TO + META ---
    bill_to_style = ParagraphStyle('billto', fontSize=8, textColor=MID_GRAY, leading=12)
    bill_name_style = ParagraphStyle('billname', fontSize=10, textColor=DARK_GRAY, fontName='Helvetica-Bold', leading=14)
    bill_addr_style = ParagraphStyle('billaddr', fontSize=9, textColor=DARK_GRAY, leading=13)
    meta_label_style = ParagraphStyle('metalabel', fontSize=9, textColor=MID_GRAY, alignment=TA_RIGHT, leading=16)
    meta_value_style = ParagraphStyle('metaval', fontSize=9, textColor=DARK_GRAY, alignment=TA_RIGHT, leading=16)

    escrow_address = data.get('escrowAddress', '').replace('\n', '<br/>')
    escrow_phone = data.get('escrowPhone', '')

    bill_to_block = [
        Paragraph('Bill To:', bill_to_style),
        Spacer(1, 4),
        Paragraph(data['escrowCompany'], bill_name_style),
        Paragraph(escrow_address, bill_addr_style),
    ]
    if escrow_phone:
        bill_to_block.append(Paragraph(escrow_phone, bill_addr_style))

    date_str = datetime.now().strftime('%b %d, %Y')
    meta_labels = Paragraph('Date:<br/>Payment Terms:<br/>Escrow#:', meta_label_style)
    meta_values = Paragraph(f'{date_str}<br/>wire<br/>{data["invoiceNumber"]}', meta_value_style)

    assignment_fee = float(str(data['assignmentFee']).replace('$','').replace(',',''))
    tc_fee = 400.0
    total = assignment_fee + tc_fee

    balance_due_table = Table([
        [
            Paragraph('Balance Due:', ParagraphStyle('bdlabel', fontSize=10, textColor=DARK_GRAY, fontName='Helvetica-Bold', alignment=TA_RIGHT)),
            Paragraph(format_currency(total), ParagraphStyle('bdval', fontSize=11, textColor=DARK_GRAY, fontName='Helvetica-Bold', alignment=TA_RIGHT))
        ]
    ], colWidths=[1.4*inch, 1.4*inch])
    balance_due_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), LIGHT_GRAY),
        ('BOX', (0,0), (-1,-1), 0.5, STEEL),
        ('ALIGN', (0,0), (-1,-1), 'RIGHT'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
    ]))

    meta_block = Table([
        [meta_labels, meta_values],
        [Spacer(1,8), ''],
        ['', balance_due_table],
    ], colWidths=[1.2*inch, 1.6*inch])
    meta_block.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('ALIGN', (0,0), (-1,-1), 'RIGHT'),
    ]))

    two_col = Table([[bill_to_block, meta_block]], colWidths=[4.2*inch, 3.0*inch])
    two_col.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'TOP')]))
    story.append(two_col)
    story.append(Spacer(1, 24))

    # --- LINE ITEMS ---
    header_style = ParagraphStyle('th', fontSize=9, textColor=colors.white, fontName='Helvetica-Bold')
    cell_style = ParagraphStyle('td', fontSize=9, textColor=DARK_GRAY, fontName='Helvetica-Bold')
    cell_right = ParagraphStyle('tdr', fontSize=9, textColor=DARK_GRAY, alignment=TA_RIGHT)
    cell_center = ParagraphStyle('tdc', fontSize=9, textColor=DARK_GRAY, alignment=TA_CENTER)

    table_data = [[
        Paragraph('Item', header_style),
        Paragraph('Quantity', ParagraphStyle('thc', fontSize=9, textColor=colors.white, fontName='Helvetica-Bold', alignment=TA_CENTER)),
        Paragraph('Rate', ParagraphStyle('thr', fontSize=9, textColor=colors.white, fontName='Helvetica-Bold', alignment=TA_RIGHT)),
        Paragraph('Amount', ParagraphStyle('thra', fontSize=9, textColor=colors.white, fontName='Helvetica-Bold', alignment=TA_RIGHT)),
    ]]

    items = [
        ('Assignment Fee ***payable to Flipur, Inc.***', 1, assignment_fee),
        ('Transaction Coordinator Fee ***payable to Flipur, Inc.***', 1, tc_fee),
    ]

    for name, qty, amt in items:
        table_data.append([
            Paragraph(name, cell_style),
            Paragraph(str(qty), cell_center),
            Paragraph(format_currency(amt), cell_right),
            Paragraph(format_currency(amt), cell_right),
        ])

    for _ in range(3):
        table_data.append(['', '', '', ''])

    items_table = Table(table_data, colWidths=[4.0*inch, 0.8*inch, 1.1*inch, 1.1*inch])
    items_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), NAVY),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, LIGHT_GRAY]),
        ('GRID', (0,0), (-1,-1), 0.25, colors.HexColor('#DDDDDD')),
        ('TOPPADDING', (0,0), (-1,-1), 7),
        ('BOTTOMPADDING', (0,0), (-1,-1), 7),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(items_table)
    story.append(Spacer(1, 16))

    # --- TOTALS ---
    totals_data = [
        ['', '', Paragraph('Subtotal:', meta_label_style), Paragraph(format_currency(total), meta_value_style)],
        ['', '', Paragraph('Tax (0%):', meta_label_style), Paragraph('$0.00', meta_value_style)],
        ['', '', Paragraph('Total:', ParagraphStyle('totlabel', fontSize=10, textColor=DARK_GRAY, fontName='Helvetica-Bold', alignment=TA_RIGHT)),
                  Paragraph(format_currency(total), ParagraphStyle('totval', fontSize=10, textColor=DARK_GRAY, fontName='Helvetica-Bold', alignment=TA_RIGHT))],
    ]
    totals_table = Table(totals_data, colWidths=[2.5*inch, 1.5*inch, 1.5*inch, 1.5*inch])
    totals_table.setStyle(TableStyle([
        ('ALIGN', (2,0), (-1,-1), 'RIGHT'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ]))
    story.append(totals_table)
    story.append(Spacer(1, 24))

    # --- NOTES ---
    notes_style = ParagraphStyle('notes', fontSize=8, textColor=MID_GRAY, leading=13)
    notes_val_style = ParagraphStyle('notesval', fontSize=9, textColor=DARK_GRAY, leading=14)
    story.append(Paragraph('Notes:', notes_style))
    story.append(Paragraph('TC Fee to be paid by assignee', notes_val_style))
    story.append(Spacer(1, 16))

    # --- WIRE INFO ---
    wire = data.get('wireInfo', {})
    story.append(Paragraph('Wire Info:', notes_style))
    story.append(Paragraph(
        f'Flipur Inc Wire Instructions<br/>'
        f'Account Number: {wire.get("accountNumber", "200001888105")}<br/>'
        f'Routing Number: {wire.get("routingNumber", "064209588")}<br/>'
        f'Bank: {wire.get("bank", "Thread Bank")}<br/>'
        f'Account Holder: {wire.get("accountHolder", "Flipur Inc")}',
        notes_val_style
    ))

    doc.build(story)
    return output_path

if __name__ == "__main__":
    data = json.loads(sys.argv[1])
    output_path = sys.argv[2]
    invoice_type = data.get("type", "escrow")
    if invoice_type == "escrow":
        generate_escrow_invoice(data, output_path)
    print(json.dumps({"success": True, "path": output_path}))
