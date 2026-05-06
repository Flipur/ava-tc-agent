const COMPANYCAM_API = "https://api.companycam.com/v2";

function getHeaders() {
  return {
    "Authorization": "Bearer " + process.env.COMPANYCAM_API_KEY,
    "Content-Type": "application/json",
  };
}

// Extract project ID from a CompanyCam URL
export function extractProjectId(url) {
  const match = url.match(/projects\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// Get project details
export async function getProject(projectId) {
  const res = await fetch(`${COMPANYCAM_API}/projects/${projectId}`, {
    headers: getHeaders(),
  });
  return res.json();
}

// Get all photos for a project with their tags and comments
export async function getProjectPhotos(projectId) {
  const res = await fetch(
    `${COMPANYCAM_API}/projects/${projectId}/photos?per_page=100`,
    { headers: getHeaders() }
  );
  const photos = await res.json();
  if (!Array.isArray(photos)) return [];

  // Fetch all photo metadata + comments in parallel
  const selected = photos.slice(0, 20);
  const enriched = await Promise.all(selected.map(async (photo) => {
    const url = photo.uris?.find(u => u.size === "large")?.uri ||
                photo.uris?.find(u => u.size === "original")?.uri ||
                photo.uris?.[0]?.uri || "";
    let caption = photo.tags?.map(t => t.display_value).join(", ") || "";

    try {
      const commRes = await fetch(
        `${COMPANYCAM_API}/photos/${photo.id}/comments`,
        { headers: getHeaders() }
      );
      const comments = await commRes.json();
      if (Array.isArray(comments) && comments.length > 0) {
        caption += (caption ? " — " : "") + comments.map(c => c.content).join("; ");
      }
    } catch (e) { /* ignore */ }

    return { id: photo.id, url, caption, coordinates: photo.coordinates || null };
  }));

  return enriched.filter(p => p.url);
}

// Get project notepad
export async function getProjectNotes(projectId) {
  try {
    const res = await fetch(`${COMPANYCAM_API}/projects/${projectId}`, {
      headers: getHeaders(),
    });
    const project = await res.json();
    return project.notepad_content || "";
  } catch (e) {
    return "";
  }
}

// Get all tags used in a project (to understand what issues were found)
export async function getProjectTags(projectId) {
  try {
    const res = await fetch(
      `${COMPANYCAM_API}/projects/${projectId}/photos?per_page=100`,
      { headers: getHeaders() }
    );
    const photos = await res.json();
    if (!Array.isArray(photos)) return [];
    const tagSet = new Set();
    for (const photo of photos) {
      for (const tag of photo.tags || []) {
        tagSet.add(tag.display_value);
      }
    }
    return Array.from(tagSet);
  } catch (e) {
    return [];
  }
}

// Full project context for Ava
export async function getCompanyCamContext(url) {
  const projectId = extractProjectId(url);
  if (!projectId) return null;

  try {
    const [project, photos, notes, tags] = await Promise.all([
      getProject(projectId),
      getProjectPhotos(projectId),
      getProjectNotes(projectId),
      getProjectTags(projectId),
    ]);

    return {
      projectId,
      name: project.name || "",
      address: project.address
        ? [project.address.street_address_1, project.address.city,
           project.address.state, project.address.postal_code]
            .filter(Boolean).join(", ")
        : "",
      photos,
      notes,
      tags,
      photoCount: photos.length,
    };
  } catch (e) {
    console.error("CompanyCam getContext error:", e.message);
    return null;
  }
}
