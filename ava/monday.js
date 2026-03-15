const MONDAY_API = "https://api.monday.com/v2";
const BOARD_ID = process.env.MONDAY_BOARD_ID;

// Column ID map — matches your Escrow Board columns
const COLUMNS = {
  status:              "status",
  requester:           "requester",
  dispoDays:           "dispo_days",
  nextStep:            "next_step",
  coe:                 "coe",
  contractAcceptance:  "contract_acceptance_date",
  emdDue:              "emd_due",
  ipEnds:              "ip_ends",
  escrow:              "escrow",
  emdAmount:           "emd_amount",
  contractPrice:       "contract_price",
  marketingPrice:      "marketing_price",
  soldPrice:           "sold_price",
  fee:                 "fee",
  buyer:               "buyer",
  supplierName:        "supplier_name",
  supplierType:        "supplier_type",
  split:               "split",
  region:              "region",
  titleCompany:        "title_company_attorney",
  titleOfficer:        "title_officer",
  onOffMarket:         "on_off_market",
  exclusive:           "exclusive",
  access:              "access",
  lockboxCode:         "lockbox_code",
  occupancy:           "current_occupancy",
  pool:                "pool",
  bedrooms:            "bedrooms",
  bathrooms:           "bathrooms",
  sqftHome:            "sqft_of_home",
  sqftAdu:             "sqft_of_adu",
  sqftLot:             "sqft_of_lot",
  yearBuilt:           "year_built",
  address:             "address",
  additionalNotes:     "additional_notes",
  dispoManager:        "dispo_manager",
  notes:               "notes",
  sellingPoints:       "selling_points",
  holdback:            "holdback_amount",
};

export async function getDealContext(text) {
  // Look for a street address pattern in the message
  const addressMatch = text.match(/\d+\s+[\w\s]+(?:st|ave|blvd|dr|ln|rd|way|ct|cir|street|avenue|boulevard|drive|lane|road)\b/i);
  if (!addressMatch) return null;

  const address = addressMatch[0].trim();

  try {
    const res = await mondayQuery(`
      query {
        boards(ids: ${BOARD_ID}) {
          items_page(limit: 5, query_params: {
            rules: [{ column_id: "name", compare_value: ["${address}"] }]
          }) {
            items {
              id
              name
              column_values { id text value }
            }
          }
        }
      }
    `);

    const items = res?.data?.boards?.[0]?.items_page?.items || [];
    if (!items.length) return null;

    const item = items[0];
    const cols = {};
    for (const col of item.column_values) {
      cols[col.id] = col.text || col.value || "";
    }

    return {
      mondayId:           item.id,
      address:            item.name,
      status:             cols[COLUMNS.status],
      requester:          cols[COLUMNS.requester],
      nextStep:           cols[COLUMNS.nextStep],
      coe:                cols[COLUMNS.coe],
      contractAcceptance: cols[COLUMNS.contractAcceptance],
      emdDue:             cols[COLUMNS.emdDue],
      ipEnds:             cols[COLUMNS.ipEnds],
      escrow:             cols[COLUMNS.escrow],
      emdAmount:          cols[COLUMNS.emdAmount],
      contractPrice:      cols[COLUMNS.contractPrice],
      marketingPrice:     cols[COLUMNS.marketingPrice],
      soldPrice:          cols[COLUMNS.soldPrice],
      fee:                cols[COLUMNS.fee],
      buyer:              cols[COLUMNS.buyer],
      supplierName:       cols[COLUMNS.supplierName],
      supplierType:       cols[COLUMNS.supplierType],
      region:             cols[COLUMNS.region],
      titleCompany:       cols[COLUMNS.titleCompany],
      titleOfficer:       cols[COLUMNS.titleOfficer],
      onOffMarket:        cols[COLUMNS.onOffMarket],
      exclusive:          cols[COLUMNS.exclusive],
      access:             cols[COLUMNS.access],
      lockboxCode:        cols[COLUMNS.lockboxCode],
      occupancy:          cols[COLUMNS.occupancy],
      bedrooms:           cols[COLUMNS.bedrooms],
      bathrooms:          cols[COLUMNS.bathrooms],
      sqftHome:           cols[COLUMNS.sqftHome],
      yearBuilt:          cols[COLUMNS.yearBuilt],
      additionalNotes:    cols[COLUMNS.additionalNotes],
      dispoManager:       cols[COLUMNS.dispoManager],
      notes:              cols[COLUMNS.notes],
      sellingPoints:      cols[COLUMNS.sellingPoints],
    };

  } catch (e) {
    console.error("Monday getDealContext error:", e.message);
    return null;
  }
}

export async function getAllActiveDeals() {
  try {
    const res = await mondayQuery(`
      query {
        boards(ids: ${BOARD_ID}) {
          items_page(limit: 50, query_params: {
            rules: [{ column_id: "status", compare_value: ["Active"] }]
          }) {
            items {
              id
              name
              column_values { id text }
            }
          }
        }
      }
    `);

    const items = res?.data?.boards?.[0]?.items_page?.items || [];
    return items.map(item => {
      const cols = Object.fromEntries(item.column_values.map(c => [c.id, c.text]));
      return {
        mondayId:      item.id,
        address:       item.name,
        coe:           cols[COLUMNS.coe],
        ipEnds:        cols[COLUMNS.ipEnds],
        emdDue:        cols[COLUMNS.emdDue],
        nextStep:      cols[COLUMNS.nextStep],
        requester:     cols[COLUMNS.requester],
        contractPrice: cols[COLUMNS.contractPrice],
        escrow:        cols[COLUMNS.escrow],
        buyer:         cols[COLUMNS.buyer],
        status:        cols[COLUMNS.status],
      };
    });
  } catch (e) {
    console.error("Monday getAllActiveDeals error:", e.message);
    return [];
  }
}

export async function updateMondayItem({ mondayId, columnId, value }) {
  return mondayQuery(`
    mutation {
      change_simple_column_value(
        board_id: ${BOARD_ID},
        item_id: ${mondayId},
        column_id: "${columnId}",
        value: "${value}"
      ) { id }
    }
  `);
}

export async function createMondayItem({ dealAddress, groupId, columnValues }) {
  const vals = JSON.stringify(JSON.stringify(columnValues));
  return mondayQuery(`
    mutation {
      create_item(
        board_id: ${BOARD_ID},
        group_id: "${groupId || "active"}",
        item_name: "${dealAddress}",
        column_values: ${vals}
      ) { id }
    }
  `);
}

async function mondayQuery(query) {
  const res = await fetch(MONDAY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.MONDAY_API_KEY,
    },
    body: JSON.stringify({ query }),
  });
  return res.json();
}
