# TrackJack

Weekly music track voting on BOT Chain. Submit tracks, upvote with a refundable BOT stake. Top-staked tracks make the featured leaderboard. Stakes are pure signal — withdraw any time.

## Networks

- Testnet: chainId 968 (0x3C8), RPC https://rpc.bohr.life
- Mainnet: chainId 677 (0x2A5), RPC https://rpc.botchain.ai

Native token: BOT.

## Quickstart

```bash
npm install
cp .env.example .env   # add PRIVATE_KEY
npx hardhat compile
npx hardhat test
npm run deploy:testnet
```

After deploy, paste the address into `CONTRACT_ADDRESS` in `frontend/index.html`, then open it (or deploy via Vercel).

## Contract

- `submitTrack(title, artist, url)` payable, fee 0.0005 BOT default
- `upvote(trackId)` payable, min 0.001 BOT default; cumulative per user
- `withdrawUpvote(trackId)` refunds stake at any time
- `getTopTracksOfWeek(weekIdx, topN)` in-memory sort DESC, topN 1-20
- Admin: pause, setSubmitFee (≤0.1), setMinUpvoteStake (≤1), withdrawFees

Invariant: `balance == sum(stakes) + accumulatedFees`.

## Frontend

Cassette-tape / mixtape theme. MetaMask connect, testnet by default. Swap block for mainnet is present in `index.html`.
