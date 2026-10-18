// Vercel serverless function → lib/routes.js
import { hotelswitch } from '../lib/routes.js';

export const config = { maxDuration: 60 };
export default hotelswitch;
