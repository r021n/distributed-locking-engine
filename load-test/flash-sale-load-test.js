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

export default function (data) {
  const userId = `loadtest_user_${__VU}_${__ITER}`;
  const payload = JSON.stringify({
    userId: userId,
    productId: data.productId,
  });

  const params = {
    headers: { "Content-Type": "application/json" },
  };

  const res = http.post(`${BASE_URL}/api/flash-sale/checkout`, payload, params);

  if (res.status === 200) {
    const body = res.json();
    check(res, {
      "checkout success": (r) => r.status === 200 && body.success === true,
    });
    successCount.add(1);
  } else if (res.status === 409) {
    const body = res.json();
    if (body.error === "SOLD_OUT") {
      soldOutCount.add(1);
    } else if (body.error === "USER_ALREADY_PURCHASED") {
      duplicateCount.add(1);
    } else {
      otherErrorCount.add(1);
    }
  } else {
    otherErrorCount.add(1);
  }
}
