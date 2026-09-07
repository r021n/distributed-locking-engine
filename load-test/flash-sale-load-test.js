import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const STOCK = parseInt(__ENV.STOCK || "50", 10);
const TOTAL_USERS = parseInt(__ENV.TOTAL_USERS || "2000", 10);
