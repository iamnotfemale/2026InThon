import { memberDataHandlers } from '../member-data.mjs';

// /api/calendar (GET ?from&to, POST) and /api/calendar/:id (PATCH, DELETE via the rewrite to ?id=).
export default function calendar(req, res) { return memberDataHandlers().calendar(req, res); }
