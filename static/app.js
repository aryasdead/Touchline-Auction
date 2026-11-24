const roomCode = document.body.dataset.roomCode;

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Something went wrong.");
  }
  return payload;
}

function showError(element, error) {
  element.textContent = error.message || "Something went wrong. Please try again.";
}

const createForm = document.querySelector("#create-form");
if (createForm) {
  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorElement = document.querySelector("#create-error");
    const button = createForm.querySelector("button");
    button.disabled = true;
    errorElement.textContent = "";
    try {
      const result = await requestJson("/api/rooms", {
        method: "POST",
        body: JSON.stringify({
          username: createForm.elements.username.value,
          room_name: createForm.elements.room_name.value,
        }),
      });
      localStorage.setItem(`football-auction:${result.code}`, result.member_id);
      window.location.assign(`/room/${result.code}`);
    } catch (error) {
      showError(errorElement, error);
    } finally {
      button.disabled = false;
    }
  });
}

if (roomCode) {
  const memberStorageKey = `football-auction:${roomCode}`;
  const joinPanel = document.querySelector("#join-panel");
  const gamePanel = document.querySelector("#game-panel");
  const joinForm = document.querySelector("#join-form");
  const toast = document.querySelector("#toast");
  let memberId = localStorage.getItem(memberStorageKey);
  let refreshPending = false;
  let inviteUrl = window.location.href;

  const showToast = (message) => {
    toast.textContent = message;
    window.setTimeout(() => {
      if (toast.textContent === message) toast.textContent = "";
    }, 3500);
  };

  const shareButton = document.querySelector("#share-button");
  if (navigator.share) shareButton.textContent = "Share invite";
  shareButton.addEventListener("click", async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: document.title,
          text: "Join my football auction room",
          url: inviteUrl,
        });
        return;
      }
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(inviteUrl);
        showToast("Invite link copied.");
        return;
      }
      window.prompt("Copy this invite link:", inviteUrl);
    } catch (error) {
      if (error.name === "AbortError") return;
      window.prompt("Copy this invite link:", inviteUrl);
    }
  });

  joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorElement = document.querySelector("#join-error");
    const button = joinForm.querySelector("button");
    button.disabled = true;
    errorElement.textContent = "";
    try {
      const result = await requestJson(`/api/rooms/${roomCode}/join`, {
        method: "POST",
        body: JSON.stringify({
          username: joinForm.elements.username.value,
          member_id: memberId || "",
        }),
      });
      memberId = result.member_id;
      localStorage.setItem(memberStorageKey, memberId);
      await refreshRoom();
    } catch (error) {
      showError(errorElement, error);
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#bid-button").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await requestJson(`/api/rooms/${roomCode}/bid`, {
        method: "POST",
        body: JSON.stringify({ member_id: memberId }),
      });
      await refreshRoom();
    } catch (error) {
      showToast(error.message);
      await refreshRoom();
    }
  });

  document.querySelector("#next-button").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await requestJson(`/api/rooms/${roomCode}/next`, {
        method: "POST",
        body: JSON.stringify({ member_id: memberId }),
      });
      await refreshRoom();
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  });

  function renderPlayer(player, state) {
    const playerCard = document.querySelector("#player-card");
    const status = document.querySelector("#auction-status");
    const bidButton = document.querySelector("#bid-button");
    const nextButton = document.querySelector("#next-button");
    const currentBid = document.querySelector("#current-bid");
    const bidderName = document.querySelector("#bidder-name");
    const bidHint = document.querySelector("#bid-hint");

    nextButton.hidden = !state.is_owner || state.room.status !== "live";
    if (!player) {
      playerCard.replaceChildren();
      const title = document.createElement("h3");
      title.textContent = state.room.status === "complete" ? "All players auctioned" : "No player on the block";
      playerCard.append(title);
      currentBid.textContent = "Auction complete";
      bidderName.textContent = "";
      bidButton.disabled = true;
      bidButton.textContent = "Auction complete";
      nextButton.hidden = true;
      status.textContent = "COMPLETE";
      status.classList.remove("live-pill");
      return;
    }

    status.textContent = "LIVE";
    status.classList.add("live-pill");
    const position = document.createElement("span");
    position.className = "player-position";
    position.textContent = `${player.position || "PLAYER"} · ${player.tier || "UNTIERED"}`.toUpperCase();
    const name = document.createElement("h3");
    name.textContent = player.player_name;
    const details = document.createElement("span");
    details.className = "player-details";
    details.textContent = [player.club, player.nationality, player.age ? `${player.age} years` : ""]
      .filter(Boolean)
      .join(" · ");
    const value = document.createElement("span");
    value.className = "player-value";
    value.textContent = `Market value  €${player.market_value_eur_m}m`;
    playerCard.replaceChildren(position, name, details, value);

    currentBid.textContent = player.bid > 0 ? `€${player.bid}m` : "No bids yet";
    bidderName.textContent = player.bidder_name ? `Leading: ${player.bidder_name}` : "";
    const alreadyLeading = player.bidder_id === memberId;
    const affordable = Number(state.member.budget) >= Number(player.next_bid);
    bidButton.textContent = alreadyLeading ? "You're leading" : `Bid €${player.next_bid}m`;
    bidButton.disabled = alreadyLeading || !affordable;
    bidHint.textContent = alreadyLeading
      ? "Wait for another manager to raise the bid."
      : affordable
        ? `Next bid increases by €${state.bid_increment}m.`
        : "Your remaining budget is too low to bid.";
  }

  function renderMembers(members) {
    const list = document.querySelector("#member-list");
    document.querySelector("#manager-count").textContent = members.length;
    list.replaceChildren();
    for (const member of members) {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.className = "member-name";
      name.append(document.createTextNode(member.name));
      if (member.is_owner) {
        const host = document.createElement("small");
        host.textContent = "HOST";
        name.append(host);
      }
      const stats = document.createElement("span");
      stats.className = "member-stats";
      stats.textContent = `€${member.budget}m · ${member.players_won} won`;
      item.append(name, stats);
      list.append(item);
    }
  }

  function renderHistory(history) {
    const list = document.querySelector("#history-list");
    list.replaceChildren();
    if (!history.length) {
      const empty = document.createElement("p");
      empty.className = "empty-history";
      empty.textContent = "Players sold or passed will show up here.";
      list.append(empty);
      return;
    }
    for (const entry of history.slice().reverse()) {
      const item = document.createElement("div");
      item.className = "history-item";
      const name = document.createElement("strong");
      name.textContent = entry.player_name;
      const result = document.createElement("span");
      result.textContent = entry.status === "sold"
        ? `Sold to ${entry.winner_name} for €${entry.bid}m`
        : "Unsold";
      item.append(name, result);
      list.append(item);
    }
  }

  async function refreshRoom() {
    if (refreshPending) return;
    refreshPending = true;
    try {
      const query = memberId ? `?member_id=${encodeURIComponent(memberId)}` : "";
      const state = await requestJson(`/api/rooms/${roomCode}${query}`);
      document.querySelector("#room-name").textContent = state.room.name;
      document.querySelector("#room-code").textContent = state.room.code;
      inviteUrl = state.room.invite_url || inviteUrl;
      if (!state.joined) {
        joinPanel.hidden = false;
        gamePanel.hidden = true;
        return;
      }
      joinPanel.hidden = true;
      gamePanel.hidden = false;
      document.querySelector("#my-budget").textContent = `€${state.member.budget}m`;
      renderPlayer(state.current_player, state);
      renderMembers(state.members);
      renderHistory(state.history);
    } catch (error) {
      showToast(error.message);
    } finally {
      refreshPending = false;
    }
  }

  refreshRoom();
  window.setInterval(refreshRoom, 2500);
}
