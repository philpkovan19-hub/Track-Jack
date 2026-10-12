const { ethers } = require("hardhat");

async function main() {
  const [signer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(signer.address);
  console.log("Deployer:", signer.address);
  console.log("Balance :", ethers.formatEther(bal), "BOT");

  const F = await ethers.getContractFactory("TrackJack");
  const c = await F.deploy();
  await c.waitForDeployment();
  const addr = await c.getAddress();

  console.log("TrackJack deployed at:", addr);
  console.log("Update CONTRACT_ADDRESS in frontend/index.html");
}

main().catch((e) => { console.error(e); process.exit(1); });
