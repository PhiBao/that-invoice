# Submission kit (drafts)

Nothing here has been posted or sent. The human posts on X, makes the repository public, and confirms the
submission payload. Personal fields (name, email, team size, payout account) are deliberately not in this file.

## Tracks to tick

`nfts` (primary), `realworld`, `defi`

## "What they built" (form field `idea`, 20-2000 characters)

That Invoice turns an invoice into a NEAR account. Today a business billing crypto clients waits 30-60 days to be paid, and selling the invoice early means factoring: the client still pays the original business, which must forward the money, and investors worry the same invoice was sold twice. In That Invoice the payment address is the asset. The registry contract creates a real NEAR account per invoice (running one immutable global contract) and mints the invoice as an NFT. The client confirms it on-chain. The owner lists it at a discount; a buyer's ft_transfer_call moves the NFT and pays the seller in one receipt. The client pays the same address, and whoever owns the NFT at that moment claims the money, so nothing is forwarded and the old owner cannot redirect it. The contract refuses a repeated (issuer, debtor, number), locks the token while it is listed or being paid out, and records each client's on-time payment history on-chain. NEAR does the work: NEP-171 plus account creation from a contract, NEP-591 global contracts for the invoice account, NEP-141 ft_transfer_call for atomic sales, and NEAR Intents 1Click for pay-from-any-chain (live dry-run quotes; Intents has no testnet). Rust contracts (46 tests) and a Rust API; a Next.js UI whose invoice has a front and a back listing every endorsement. The live demo runs the full lifecycle with real testnet transactions in about 45 seconds, including the two refusals.

## X post (draft)

> Waiting 60 days to get paid is normal. Selling the invoice early usually means the client still pays you, and you forward it.
>
> That Invoice: every invoice is its own NEAR account. Sell it, and the client's payment goes to the new owner. Sell it twice and the contract says no.
>
> Built at NEAR HACKATHON @NEARProtocol #NEARHackathon
>
> Demo and repo: <link>
> What would stop you selling an invoice this way?

Attach: the screen recording (below). Optional tags: @NearLegion @NearBuilders.

## Video shot list (about 75 seconds, no voiceover needed)

1. 0:00 Title card: "The invoice is the account." (3s)
2. 0:03 `/demo`, press **Run the demo**. Let steps tick in. Keep the right-hand invoice visible. (35s)
3. 0:38 Zoom on the two red **Refused by the contract** notes. (6s)
4. 0:44 Click through to the invoice. Press **Endorsements ↻** to flip it. Hold on the chain of endorsements. (10s)
5. 0:54 Click one transaction link to show it on the explorer. (5s)
6. 1:00 Show the **Pay from any chain** panel's live quotes. Caption: "NEAR Intents dry-run, mainnet liquidity". (8s)
7. 1:08 End card: repo link, "testnet demo, test USDC". (5s)

Record at 1360x800 or larger; the demo takes 45-50 seconds on a good connection, so start recording before pressing run.
