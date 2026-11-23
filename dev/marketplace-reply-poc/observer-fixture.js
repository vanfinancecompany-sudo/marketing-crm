const host = document.getElementById("observer-fixture");
const stateKey = "marketplaceObserverFixtureArrivals";
const unreadKey = "marketplaceObserverFixtureUnread";
let arrivals = Number(localStorage.getItem(stateKey) || 0);
let unread = localStorage.getItem(unreadKey) === "true";

function render() {
  host.replaceChildren();
  for (const { id, listing, read, closed } of [
    { id: "100", listing: "1001", read: true },
    { id: "200", listing: "2002", read: true },
    { id: "300", listing: "1001", read: !unread, closed: true },
    { id: "400", listing: "9000", read: true },
  ]) {
    const thread = document.createElement("article");
    thread.dataset.fixtureThread = id;
    thread.dataset.alreadyRead = String(read);
    thread.dataset.fixtureOpen = String(!closed);
    thread.dataset.historyReady = String(!closed);
    const link = document.createElement("a");
    link.dataset.fixtureListing = "";
    link.href = "https://www.facebook.com/marketplace/item/" + listing + "/";
    link.textContent = "Synthetic listing " + listing;
    link.addEventListener("click", (event) => event.preventDefault());
    thread.append(link);
    const messages = [
      { id: "mid.$" + id + ":baseline", direction: "incoming" },
      { id: "mid.$" + id + ":seller", direction: "outgoing" },
    ];
    for (let index = 1; index <= arrivals; index++) messages.push({ id: "mid.$" + id + ":" + index, direction: "incoming" });
    if (arrivals) messages.push({ id: null, direction: "unknown" });
    for (const [index, message] of (closed ? [] : messages).entries()) {
      const paragraph = document.createElement("p");
      paragraph.dataset.fixtureDirection = message.direction;
      paragraph.dataset.fixtureSequence = String(index + 1);
      if (message.id) paragraph.dataset.messageId = message.id;
      paragraph.textContent = "Synthetic message";
      thread.append(paragraph);
    }
    host.append(thread);
  }
}

document.getElementById("arrive").addEventListener("click", () => {
  arrivals = Math.min(arrivals + 1, 20);
  localStorage.setItem(stateKey, String(arrivals));
  render();
});
document.getElementById("unread").addEventListener("click", () => {
  unread = !unread;
  localStorage.setItem(unreadKey, String(unread));
  render();
});
window.addEventListener("storage", (event) => {
  if (event.key === stateKey) arrivals = Number(event.newValue || 0);
  else if (event.key === unreadKey) unread = event.newValue === "true";
  else return;
  render();
});
document.getElementById("replay").addEventListener("click", render);
document.getElementById("challenge").addEventListener("click", () => { host.dataset.fixtureHealth = "security-challenge"; });
render();
