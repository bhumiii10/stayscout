// Vercel serverless function → lib/routes.js
import { place } from '../lib/routes.js';

export const config = { maxDuration: 60 };
export default place;
