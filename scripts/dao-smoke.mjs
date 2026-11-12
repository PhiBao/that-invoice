import { account, view, NEAR, TGAS, daoPropose, daoApprove } from "./lib.mjs";
const REG = "endorse-v1.testnet", DAO = "thatinvoice-acme.sputnikv2.testnet";
const number = "DAO-" + Date.now().toString(36);
await account("endorse-studio.testnet").callFunction({ contractId: REG, methodName: "issue", deposit: NEAR(0.1), gas: TGAS(150),
  args: { debtor: DAO, number, amount: "1200000000", due_ms: String(Date.now() + 30 * 864e5), doc_hash: "" } });
await new Promise((r) => setTimeout(r, 2500));
const id = (await view(REG, "invoices", { from_index: "0", limit: 100 })).reverse().find((i) => i.number === number).id;
console.log("invoice", id, "debtor", DAO);
const pid = await daoPropose({ dao: DAO, proposer: "endorse-acme.testnet", receiver: REG, method: "confirm", args: { id }, description: `Confirm invoice ${number} from Studio Nine ($1,200)` });
console.log("proposal", pid, JSON.stringify((await view(DAO, "get_proposal", { id: pid })).status));
const r = await daoApprove({ dao: DAO, council: "council.endorse-fund.testnet", id: pid });
console.log("approve tx", r.transaction.hash);
await new Promise((r) => setTimeout(r, 3000));
const inv = await view(REG, "invoice", { id });
console.log("status:", inv.status, "| confirmed by:", inv.log.find((l) => l.kind === "Confirmed")?.by);
console.log("proposal status:", (await view(DAO, "get_proposal", { id: pid })).status);
