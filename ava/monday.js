const MONDAY_API = "https://api.monday.com/v2";
const BOARD_ID = process.env.MONDAY_BOARD_ID;

const COLUMNS = {
  name:               "name",
  contract:           "file_mkt9v3s9",
  requester:          "dropdown47__1",
  dispoDays:          "formula9__1",
  status:             "status",
  nextStep:           "status__1",
  coe:                "date__1",
  contractAcceptance: "date_17__1",
  emdDue:             "date_1__1",
  ipEnds:             "date_14__1",
  escrow:             "text82__1",
  emdAmount:          "numbers9__1",
  contractPrice:      "numbers__1",
  marketingPrice:     "numbers3__1",
  soldPrice:          "sold_price__1",
  fee:                "numbers7__1",
  buyer:              "dropdown7__1",
  highestBuyerOffer:  "numbers30__1",
  supplierName:       "text429__1",
  supplierType:       "status4__1",
  split:              "dup__of_exclusive__1",
  splitAmount:        "text93__1",
  notes:              "long_text8__1",
  dispoManager:       "dropdown72__1",
  titleCompany:       "text57__1",
  titleOfficer:       "text67__1",
  onOffMarket:        "status2__1",
  exclusive:          "status46__1",
  access:             "status44__1",
  lockboxCode:        "short_text__1",
  occupancy:          "status5__1",
  postPossession:     "numbers82__1",
  holdback:           "number06__1",
  additionalNotes:    "long_text09__1",
  pool:               "status9__1",
  sellingPoints:      "long_text4__1",
  region:             "status426__1",
  dateCreated:        "date4__1",
  bedrooms:           "number02__1",
  bathrooms:          "number1__1",
  sqftHome:           "number10__1",
  sqftAdu:            "number7__1",
  sqftLot:            "number19__1",
  address:            "location8__1",
  hasGarage:          "true___false__1",
  garageSpaces:       "number3__1",
  photos:             "link__1",
  additionalInfo:     "text12__1",
  yearBuilt:          "text86__1",
};

export async function getDealContext(text) {
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
      split:              cols[COLUMNS.split],
      notes:              cols[COLUMNS.notes],
      dispoManager:       cols[COLUMNS.dispoManager],
      titleCompany:       cols[COLUMNS.titleCompany],
      titleOfficer:       cols[COLUMNS.titleOfficer],
      onOffMarket:        cols[COLUMNS.onOffMarket],
      exclusive:          cols[COLUMNS.exclusive],
      access:             cols[COLUMNS.access],
      lockboxCode:        cols[COLUMNS.lockboxCode],
      occupancy:          cols[COLUMNS.occupancy],
      additionalNotes:    cols[COLUMNS.additionalNotes],
      pool:               cols[COLUMNS.pool],
      sellingPoints:      cols[COLUMNS.sellingPoints],
      region:             cols[COLUMNS.region],
      bedrooms:           cols[COLUMNS.bedrooms],
      bathrooms:          cols[COLUMNS.bathrooms],
      sqftHome:           cols[COLUMNS.sqftHome],
      sqftLot:            cols[COLUMNS.sqftLot],
      yearBuilt:          cols[COLUMNS.yearBuilt],
      additionalInfo:     cols[COLUMNS.additionalInfo],
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
        region:        cols[COLUMNS.region],
        dispoManager:  cols[COLUMNS.dispoManager],
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
