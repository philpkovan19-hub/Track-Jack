const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TrackJack", function () {
  let tj, owner, alice, bob, carol;
  const FEE = ethers.parseEther("0.0005");
  const MIN = ethers.parseEther("0.001");

  beforeEach(async () => {
    [owner, alice, bob, carol] = await ethers.getSigners();
    const F = await ethers.getContractFactory("TrackJack");
    tj = await F.deploy();
    await tj.waitForDeployment();
  });

  async function sub(signer, title = "Song", artist = "Artist", url = "") {
    const tx = await tj.connect(signer).submitTrack(title, artist, url, { value: FEE });
    await tx.wait();
    const c = await tj.trackCount();
    return Number(c) - 1;
  }

  it("submits with fee and validates lengths", async () => {
    const id = await sub(alice, "Track A", "Alice");
    expect(id).to.equal(0);
    const t = await tj.getTrack(0);
    expect(t.submitter).to.equal(alice.address);
    expect(t.title).to.equal("Track A");

    await expect(tj.connect(alice).submitTrack("t", "a", "", { value: 0 })).to.be.revertedWith("fee");
    await expect(tj.connect(alice).submitTrack("", "a", "", { value: FEE })).to.be.revertedWith("title len");
    await expect(tj.connect(alice).submitTrack("t", "", "", { value: FEE })).to.be.revertedWith("artist len");
    const bigUrl = "x".repeat(257);
    await expect(tj.connect(alice).submitTrack("t", "a", bigUrl, { value: FEE })).to.be.revertedWith("url len");
  });

  it("upvote adds to stake and increments unique voters once", async () => {
    const id = await sub(alice);
    await tj.connect(bob).upvote(id, { value: MIN });
    let t = await tj.getTrack(id);
    expect(t.totalStake).to.equal(MIN);
    expect(t.uniqueVoters).to.equal(1n);

    // same user again — no unique voter increment
    await tj.connect(bob).upvote(id, { value: MIN });
    t = await tj.getTrack(id);
    expect(t.totalStake).to.equal(MIN * 2n);
    expect(t.uniqueVoters).to.equal(1n);
    expect(await tj.getUserVote(id, bob.address)).to.equal(MIN * 2n);
  });

  it("rejects upvote below min and on missing track", async () => {
    const id = await sub(alice);
    await expect(tj.connect(bob).upvote(id, { value: 1 })).to.be.revertedWith("min stake");
    await expect(tj.connect(bob).upvote(999, { value: MIN })).to.be.revertedWith("no track");
  });

  it("withdrawUpvote returns exact stake and clears record", async () => {
    const id = await sub(alice);
    const stake = ethers.parseEther("0.02");
    await tj.connect(bob).upvote(id, { value: stake });
    const before = await ethers.provider.getBalance(bob.address);
    const tx = await tj.connect(bob).withdrawUpvote(id);
    const rcpt = await tx.wait();
    const gas = rcpt.gasUsed * rcpt.gasPrice;
    const after = await ethers.provider.getBalance(bob.address);
    expect(after + gas - before).to.equal(stake);
    expect(await tj.getUserVote(id, bob.address)).to.equal(0);
    const t = await tj.getTrack(id);
    expect(t.totalStake).to.equal(0);
    expect(t.uniqueVoters).to.equal(0n);
  });

  it("cannot withdraw when nothing staked", async () => {
    const id = await sub(alice);
    await expect(tj.connect(bob).withdrawUpvote(id)).to.be.revertedWith("nothing staked");
  });

  it("getUserVote is accurate across users", async () => {
    const id = await sub(alice);
    await tj.connect(bob).upvote(id, { value: MIN });
    await tj.connect(carol).upvote(id, { value: MIN * 3n });
    expect(await tj.getUserVote(id, bob.address)).to.equal(MIN);
    expect(await tj.getUserVote(id, carol.address)).to.equal(MIN * 3n);
  });

  it("top-N sort is correct DESC by totalStake", async () => {
    const a = await sub(alice, "A", "x");
    const b = await sub(alice, "B", "x");
    const c = await sub(alice, "C", "x");
    await tj.connect(bob).upvote(a, { value: MIN });
    await tj.connect(bob).upvote(b, { value: MIN * 5n });
    await tj.connect(bob).upvote(c, { value: MIN * 3n });
    const wk = await tj.getCurrentWeek();
    const top = await tj.getTopTracksOfWeek(wk, 3);
    expect(top.map(x => Number(x))).to.deep.equal([b, c, a]);

    const top2 = await tj.getTopTracksOfWeek(wk, 2);
    expect(top2.map(x => Number(x))).to.deep.equal([b, c]);
  });

  it("weekly index math matches timestamp/604800", async () => {
    const block = await ethers.provider.getBlock("latest");
    const expected = Math.floor(block.timestamp / 604800);
    const wk = await tj.getCurrentWeek();
    expect(Number(wk)).to.equal(expected);
  });

  it("getTracksByWeek and getTracksBySubmitter track memberships", async () => {
    const a = await sub(alice);
    const b = await sub(bob);
    const wk = await tj.getCurrentWeek();
    const wkTracks = await tj.getTracksByWeek(wk);
    expect(wkTracks.map(x => Number(x))).to.include.members([a, b]);
    const aliceTracks = await tj.getTracksBySubmitter(alice.address);
    expect(aliceTracks.map(x => Number(x))).to.deep.equal([a]);
  });

  it("admin bounds and only-owner enforced", async () => {
    await expect(tj.connect(alice).setSubmitFee(1)).to.be.reverted;
    await expect(tj.setSubmitFee(ethers.parseEther("0.2"))).to.be.revertedWith("max");
    await expect(tj.setMinUpvoteStake(ethers.parseEther("2"))).to.be.revertedWith("max");
    await tj.setSubmitFee(ethers.parseEther("0.01"));
    expect(await tj.submitFee()).to.equal(ethers.parseEther("0.01"));
    await expect(tj.getTopTracksOfWeek(0, 0)).to.be.revertedWith("topN");
    await expect(tj.getTopTracksOfWeek(0, 21)).to.be.revertedWith("topN");
  });

  it("pause blocks submit and upvote", async () => {
    await tj.pause();
    await expect(tj.connect(alice).submitTrack("t", "a", "", { value: FEE })).to.be.reverted;
    await tj.unpause();
    const id = await sub(alice);
    await tj.pause();
    await expect(tj.connect(bob).upvote(id, { value: MIN })).to.be.reverted;
    // withdraw still works even when paused
    await tj.unpause();
    await tj.connect(bob).upvote(id, { value: MIN });
    await tj.pause();
    await tj.connect(bob).withdrawUpvote(id);
  });

  it("owner can withdraw only submit fees, not stakes", async () => {
    const id = await sub(alice);
    await tj.connect(bob).upvote(id, { value: MIN * 10n });
    const acc = await tj.accumulatedFees();
    expect(acc).to.equal(FEE);
    const before = await ethers.provider.getBalance(owner.address);
    const tx = await tj.withdrawFees(owner.address);
    const rcpt = await tx.wait();
    const gas = rcpt.gasUsed * rcpt.gasPrice;
    const after = await ethers.provider.getBalance(owner.address);
    expect(after + gas - before).to.equal(FEE);
  });

  it("invariant: balance == sum(stakes) + accumulatedFees after mixed ops", async () => {
    const a = await sub(alice);
    const b = await sub(bob);
    await tj.connect(carol).upvote(a, { value: MIN * 4n });
    await tj.connect(bob).upvote(a, { value: MIN * 2n });
    await tj.connect(alice).upvote(b, { value: MIN * 7n });
    await tj.connect(carol).withdrawUpvote(a);
    await tj.connect(alice).upvote(b, { value: MIN });

    const bal = await ethers.provider.getBalance(await tj.getAddress());
    const fees = await tj.accumulatedFees();
    const sBobA = await tj.getUserVote(a, bob.address);
    const sCarolA = await tj.getUserVote(a, carol.address);
    const sAliceB = await tj.getUserVote(b, alice.address);
    const sum = sBobA + sCarolA + sAliceB;
    expect(bal).to.equal(sum + fees);
  });
});
