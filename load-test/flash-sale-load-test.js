import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const STOCK = parseInt(__ENV.STOCK || "50", 10);
const TOTAL_USERS = parseInt(__ENV.TOTAL_USERS || "2000", 10);

const successCount = new Counter("checkout_success");
const soldOutCount = new Counter("checkout_sold_out");
const duplicateCount = new Counter("checkout_duplicate");
const otherErrorCount = new Counter("checkout_other_error");

export const options = {
  scenarios: {
    flash_sale_burst: {
      executor: "constant-arrival-rate",
      rate: TOTAL_USERS,
      timeUnit: "2s",
      duration: "2s",
      preAllocatedVUs: TOTAL_USERS,
      maxUVs: TOTAL_USERS,
    },
  },
  thresholds: {
    http_req_duration: ["p(99)<500"],
    checkout_success: [`count==${STOCK}`],
    checkout_sold_out: [`count>=${TOTAL_USERS - STOCK}`],
  },
};

export function setup() {
  console.log(`\n=== FLASH SALE LOAD TEST SETUP ===`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Stock: ${STOCK}`);
  console.log(`Total VUs/Users: ${TOTAL_USERS}`);

  const seedRes = http.post(
    `${BASE_URL}/__test/seed`,
    JSON.stringify({ stock: STOCK }),
    { headers: { "Content-Type": "application/json" } },
  );

  if (seedRes.status !== 200) {
    throw new Error(`Setup failed: seed returned status: ${seedRes.status}`);
  }

  const seedData = seedRes.json();
  console.log(
    `Seeded product ID: ${seedData.productId}, stock: ${seedData.stock}`,
  );

  return { productId: seedData.productId };
}
