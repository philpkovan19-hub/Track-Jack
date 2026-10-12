// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title TrackJack — weekly music track voting with refundable stakes
/// @notice Users submit tracks and upvote by staking BOT. Stakes are always refundable.
contract TrackJack is Ownable, ReentrancyGuard, Pausable {
    uint256 public constant WEEK = 604800; // seconds in a week (Thursday-anchored via unix epoch)
    uint256 public constant MAX_SUBMIT_FEE = 0.1 ether;
    uint256 public constant MAX_MIN_UPVOTE = 1 ether;

    struct Track {
        address submitter;
        string title;
        string artist;
        string url;
        uint256 totalStake;
        uint256 uniqueVoters;
        uint256 submittedAt;
        uint16 weekIdx;
    }

    uint256 public submitFee = 0.0005 ether;
    uint256 public minUpvoteStake = 0.001 ether;
    uint256 public accumulatedFees;

    Track[] private _tracks;
    // trackId => voter => stake
    mapping(uint256 => mapping(address => uint256)) private _stakes;
    // week => trackIds
    mapping(uint16 => uint256[]) private _weekTracks;
    // submitter => trackIds
    mapping(address => uint256[]) private _submitterTracks;

    event TrackSubmitted(uint256 indexed trackId, address indexed submitter, uint16 indexed weekIdx, string title, string artist);
    event Upvoted(uint256 indexed trackId, address indexed voter, uint256 amount, uint256 newStake);
    event Withdrawn(uint256 indexed trackId, address indexed voter, uint256 amount);

    constructor() Ownable(msg.sender) {}

    // ---------- User actions ----------

    function submitTrack(string calldata title, string calldata artist, string calldata url)
        external
        payable
        whenNotPaused
        returns (uint256 trackId)
    {
        require(msg.value >= submitFee, "fee");
        bytes memory t = bytes(title);
        bytes memory a = bytes(artist);
        bytes memory u = bytes(url);
        require(t.length >= 1 && t.length <= 100, "title len");
        require(a.length >= 1 && a.length <= 100, "artist len");
        require(u.length <= 256, "url len");

        uint16 wk = _currentWeek();
        trackId = _tracks.length;
        _tracks.push(Track({
            submitter: msg.sender,
            title: title,
            artist: artist,
            url: url,
            totalStake: 0,
            uniqueVoters: 0,
            submittedAt: block.timestamp,
            weekIdx: wk
        }));
        _weekTracks[wk].push(trackId);
        _submitterTracks[msg.sender].push(trackId);
        accumulatedFees += msg.value;

        emit TrackSubmitted(trackId, msg.sender, wk, title, artist);
    }

    function upvote(uint256 trackId) external payable whenNotPaused nonReentrant {
        require(trackId < _tracks.length, "no track");
        require(msg.value >= minUpvoteStake, "min stake");

        uint256 prior = _stakes[trackId][msg.sender];
        if (prior == 0) {
            _tracks[trackId].uniqueVoters += 1;
        }
        uint256 newStake = prior + msg.value;
        _stakes[trackId][msg.sender] = newStake;
        _tracks[trackId].totalStake += msg.value;

        emit Upvoted(trackId, msg.sender, msg.value, newStake);
    }

    function withdrawUpvote(uint256 trackId) external nonReentrant {
        require(trackId < _tracks.length, "no track");
        uint256 amount = _stakes[trackId][msg.sender];
        require(amount > 0, "nothing staked");
        _stakes[trackId][msg.sender] = 0;
        _tracks[trackId].totalStake -= amount;
        _tracks[trackId].uniqueVoters -= 1;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "send fail");

        emit Withdrawn(trackId, msg.sender, amount);
    }

    // ---------- Views ----------

    function getTrack(uint256 trackId) external view returns (
        address submitter,
        string memory title,
        string memory artist,
        string memory url,
        uint256 totalStake,
        uint256 uniqueVoters,
        uint256 submittedAt,
        uint16 weekIdx
    ) {
        require(trackId < _tracks.length, "no track");
        Track storage t = _tracks[trackId];
        return (t.submitter, t.title, t.artist, t.url, t.totalStake, t.uniqueVoters, t.submittedAt, t.weekIdx);
    }

    function getUserVote(uint256 trackId, address voter) external view returns (uint256 stakeAmount) {
        return _stakes[trackId][voter];
    }

    function getTracksByWeek(uint16 weekIdx) external view returns (uint256[] memory) {
        return _weekTracks[weekIdx];
    }

    function getTracksBySubmitter(address who) external view returns (uint256[] memory) {
        return _submitterTracks[who];
    }

    function getCurrentWeek() external view returns (uint16) {
        return _currentWeek();
    }

    function trackCount() external view returns (uint256) {
        return _tracks.length;
    }

    /// @notice Top N tracks of a week by totalStake (DESC). In-memory selection sort; topN capped 1-20.
    function getTopTracksOfWeek(uint16 weekIdx, uint8 topN) external view returns (uint256[] memory) {
        require(topN >= 1 && topN <= 20, "topN");
        uint256[] storage ids = _weekTracks[weekIdx];
        uint256 n = ids.length;
        uint256 k = topN;
        if (k > n) k = n;

        uint256[] memory pool = new uint256[](n);
        for (uint256 i = 0; i < n; i++) pool[i] = ids[i];

        uint256[] memory out = new uint256[](k);
        for (uint256 i = 0; i < k; i++) {
            uint256 bestIdx = i;
            uint256 bestStake = _tracks[pool[i]].totalStake;
            for (uint256 j = i + 1; j < n; j++) {
                uint256 s = _tracks[pool[j]].totalStake;
                if (s > bestStake) {
                    bestStake = s;
                    bestIdx = j;
                }
            }
            if (bestIdx != i) {
                (pool[i], pool[bestIdx]) = (pool[bestIdx], pool[i]);
            }
            out[i] = pool[i];
        }
        return out;
    }

    // ---------- Admin ----------

    function setSubmitFee(uint256 v) external onlyOwner {
        require(v <= MAX_SUBMIT_FEE, "max");
        submitFee = v;
    }

    function setMinUpvoteStake(uint256 v) external onlyOwner {
        require(v <= MAX_MIN_UPVOTE, "max");
        minUpvoteStake = v;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function withdrawFees(address payable to) external onlyOwner nonReentrant {
        uint256 amt = accumulatedFees;
        require(amt > 0, "zero");
        accumulatedFees = 0;
        (bool ok, ) = to.call{value: amt}("");
        require(ok, "send fail");
    }

    // ---------- Internal ----------

    function _currentWeek() internal view returns (uint16) {
        return uint16(block.timestamp / WEEK);
    }
}
