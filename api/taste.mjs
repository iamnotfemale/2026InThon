import { memberDataHandlers } from '../member-data.mjs';

// /api/taste (GET) and /api/taste/:content_id (PUT, DELETE via the rewrite to ?id=).
export default function taste(req, res) { return memberDataHandlers().taste(req, res); }
