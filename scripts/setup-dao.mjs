// Create the Acme DAO on testnet (a real Sputnik DAO) with a separate council approver.
//   node scripts/setup-dao.mjs
import { account, balance, createSubAccount, NEAR, view, createDao } from "./lib.mjs";
const FACTORY = "sputnikv2.testnet";
const NAME = process.env.DAO_NAME ?? "thatinvoice-acme";
const CREATOR = "endorse-fund.testnet";                // pays the 6 NEAR creation deposit
const COUNCIL = "council.endorse-fund.testnet";        // the approver key (a separate person in real life)
const DAO = `${NAME}.${FACTORY}`;

if (await createSubAccount(CREATOR, COUNCIL, NEAR(1))) console.log("created council account", COUNCIL);
if ((await balance(DAO)) === null) {
  const r = await createDao({ factory: FACTORY, name: NAME, creator: CREATOR, council: COUNCIL, purpose: "Pays contractors; confirms invoices by proposal." });
  console.log("create tx:", r.transaction.hash, JSON.stringify(r.status).slice(0, 120));
}
const policy = await view(DAO, "get_policy");
console.log("DAO", DAO, "balance", await balance(DAO), "NEAR");
console.log("roles:", policy.roles.map((x) => `${x.name}=${JSON.stringify(x.kind)}`).join(" | "));
console.log("default vote policy:", JSON.stringify(policy.default_vote_policy), "bond", policy.proposal_bond);
