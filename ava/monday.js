const MONDAY_API = "https://api.monday.com/v2";
const BOARD_ID = process.env.MONDAY_BOARD_ID;

export async function getDealContext(text) {
  const addressMatch = text.match(/\d+\s+[\w\s]+(?:st|ave|blvd|dr|ln|rd|way|ct)\b/i);
  if (!addressMatch) return null;

  const address = addressMatch[0];

  try {
    const res = await mondayQuery(`
      query {
        boards(ids: ${BOARD_ID}) {
          items_page(limit: 5, query_params: {
            rules: [{ column_id: "name", compare_value: "${address}" }]
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
    if (!items.length) return null;

    const item = items[0];
    const cols = Object.fromEntries(item.column_values.map(c => [c.id, c.text]));
    return { address: item.name, mondayId: item.id, ...cols };

  } catch (e) {
    console.error("Monday getDealContext error:", e);
    return null;
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
        group_id: "${groupId}",
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
