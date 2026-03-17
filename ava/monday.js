const MONDAY_API = "https://api.monday.com/v2";
const BOARD_ID = process.env.MONDAY_BOARD_ID;

const ALL_GROUPS = ["topics", "group_title", "new_group_mkmpnj2k", "new_group__1", "group_mkzmxp5x", "new_group30621__1"];

const C = {
  requester:          "dropdown47__1",
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
  supplierName:       "text429__1",
  supplierType:       "status4__1",
  split:              "dup__of_exclusive__1",
  notes:              "long_text8__1",
  dispoManager:       "dropdown72__1",
  titleCompany:       "text57__1",
  titleOfficer:       "text67__1",
  onOffMarket:        "status2__1",
  exclusive:          "status46__1",
  access:             "status44__1",
  lockboxCode:        "short_text__1",
  occupancy:          "status5__1",
  additionalNotes:    "long_text09__1",
  pool:               "status9__1",
  sellingPoints:      "long_text4__1",
  region:             "status426__1",
  bedrooms:           "number02__1",
  bathrooms:          "number1__1",
  sqftHome:           "number10__1",
  sqftLot:            "number19__1",
  yearBuilt:          "text86__1",
  additionalInfo:     "text12__1",
};

function extractSearchTerm(rawText) {
  // Strip Slack formatting
  const text = rawText
    .replace(/<mailto:[^>]+>/g, "")
    .replace(/<https?:[^>]+>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\$[\d,]+/g, "")  // strip dollar amounts like $860,000
    .replace(/\d+%/g, "")      // strip percentages
    .trim();
  const t = text.toLowerCase();

  // Must be 3-6 digit street number followed by a street name
  const withNumber = text.match(/\b(\d{3,6})\s+([A-Za-z][^,\n?]{2,})/);
  if (withNumber) return (withNumber[1] + " " + withNumber[2]).trim().toLowerCase();

  const withStreet = text.match(/(?:on|for|about|at|the)\s+([\w\s]+(?:cir|st|ave|blvd|dr|ln|rd|way|ct|park|glen|hill|lake|ridge|terrace)\b[^,\n?]*)/i);
  if (withStreet) return withStreet[1].trim().toLowerCase();

  const cities = [
    "inglewood","torrance","compton","pasadena","riverside","modesto","sacramento",
    "oakland","emeryville","fresno","bakersfield","hemet","acton","danville","belmont",
    "norwalk","carson","lancaster","downey","barstow","eureka","novato","buena park",
    "mission viejo","fountain valley","huntington beach","san clemente","san marcos",
    "santa monica","silver lake","atwater","baldwin hills","leimert park","hyde park",
    "mar vista","westchester","eagle rock","jefferson park","south la","beverly glen",
    "fairfax","redondo beach","spa"
  ];

  for (const city of cities) {
    if (t.includes(city)) return city;
  }

  return null;
}

function itemToDeal(item) {
  const cols = {};
  for (const col of item.column_values) cols[col.id] = col.text || col.value || "";
  return {
    mondayId: item.id, address: item.name,
    status: cols[C.status], requester: cols[C.requester],
    nextStep: cols[C.nextStep], coe: cols[C.coe],
    contractAcceptance: cols[C.contractAcceptance],
    emdDue: cols[C.emdDue], ipEnds: cols[C.ipEnds],
    escrow: cols[C.escrow], emdAmount: cols[C.emdAmount],
    contractPrice: cols[C.contractPrice], marketingPrice: cols[C.marketingPrice],
    soldPrice: cols[C.soldPrice], fee: cols[C.fee],
    buyer: cols[C.buyer], supplierName: cols[C.supplierName],
    supplierType: cols[C.supplierType], split: cols[C.split],
    notes: cols[C.notes], dispoManager: cols[C.dispoManager],
    titleCompany: cols[C.titleCompany], titleOfficer: cols[C.titleOfficer],
    onOffMarket: cols[C.onOffMarket], exclusive: cols[C.exclusive],
    access: cols[C.access], lockboxCode: cols[C.lockboxCode],
    occupancy: cols[C.occupancy], additionalNotes: cols[C.additionalNotes],
    pool: cols[C.pool], sellingPoints: cols[C.sellingPoints],
    region: cols[C.region], bedrooms: cols[C.bedrooms],
    bathrooms: cols[C.bathrooms], sqftHome: cols[C.sqftHome],
    sqftLot: cols[C.sqftLot], yearBuilt: cols[C.yearBuilt],
  };
}

async function fetchAllItems() {
  const allItems = [];
  for (const groupId of ALL_GROUPS) {
    try {
      const res = await mondayQuery(`query {
        boards(ids: ${BOARD_ID}) {
          groups(ids: "${groupId}") {
            items_page(limit: 200) {
              items { id name column_values { id text value } }
            }
          }
        }
      }`);
      const items = res?.data?.boards?.[0]?.groups?.[0]?.items_page?.items || [];
      allItems.push(...items);
    } catch (e) {
      console.error("Monday fetchAllItems error for group", groupId, e.message);
    }
  }
  return allItems;
}

export async function getDealContext(text) {
  const searchTerm = extractSearchTerm(text);
  if (!searchTerm) return null;
  console.log("Monday searching for:", searchTerm);

  try {
    const items = await fetchAllItems();
    console.log("Monday total items:", items.length);

    const matches = items.filter(i => i.name.toLowerCase().includes(searchTerm));
    console.log("Monday matches:", matches.length, matches.map(i => i.name));

    if (matches.length === 0) return { notFound: true };
    if (matches.length === 1) return itemToDeal(matches[0]);
    return { deals: matches.map(itemToDeal) };

  } catch (e) {
    console.error("Monday getDealContext error:", e.message);
    return null;
  }
}

export async function getAllActiveDeals() {
  try {
    const res = await mondayQuery(`query {
      boards(ids: ${BOARD_ID}) {
        groups(ids: "topics") {
          items_page(limit: 200) {
            items { id name column_values { id text } }
          }
        }
      }
    }`);
    const items = res?.data?.boards?.[0]?.groups?.[0]?.items_page?.items || [];
    return items
      .filter(item => {
        const cols = Object.fromEntries(item.column_values.map(c => [c.id, c.text]));
        return cols[C.status] === "Active";
      })
      .map(item => {
        const cols = Object.fromEntries(item.column_values.map(c => [c.id, c.text]));
        return {
          mondayId: item.id, address: item.name,
          coe: cols[C.coe], ipEnds: cols[C.ipEnds],
          emdDue: cols[C.emdDue], nextStep: cols[C.nextStep],
          requester: cols[C.requester], contractPrice: cols[C.contractPrice],
          escrow: cols[C.escrow], buyer: cols[C.buyer],
          status: cols[C.status], region: cols[C.region],
          dispoManager: cols[C.dispoManager],
        };
      });
  } catch (e) {
    console.error("Monday getAllActiveDeals error:", e.message);
    return [];
  }
}

export async function updateMondayItem({ mondayId, columnId, value }) {
  return mondayQuery(`mutation {
    change_simple_column_value(
      board_id: ${BOARD_ID}, item_id: ${mondayId},
      column_id: "${columnId}", value: "${value}"
    ) { id }
  }`);
}

export async function createMondayItem({ dealAddress, groupId, columnValues }) {
  const vals = JSON.stringify(JSON.stringify(columnValues));
  return mondayQuery(`mutation {
    create_item(
      board_id: ${BOARD_ID}, group_id: "${groupId || "topics"}",
      item_name: "${dealAddress}", column_values: ${vals}
    ) { id }
  }`);
}

async function mondayQuery(query) {
  const res = await fetch(MONDAY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: process.env.MONDAY_API_KEY },
    body: JSON.stringify({ query }),
  });
  return res.json();
}
