const host = document.getElementById("observer-fixture");
const stateKey = "marketplaceObserverFixtureArrivals";
let arrivals = Number(localStorage.getItem(stateKey) || 0);

function render() {
  host.replaceChildren();
  for (const { id, listing, read } of [
    { id: "100", listing: "1001", read: true },
    { id: "200", listing: "2002", read: true },
    { id: "300", listing: "1001", read: false },
    { id: "400", listing: "9000", read: true },
  ]) {
    const thread = document.createElement("article");
    thread.dataset.fixtureThread = id;
    thread.dataset.alreadyRead = String(read);
    thread.dataset.historyReady = "true";
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
    for (const [index, message] of messages.entries()) {
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
document.getElementById("replay").addEventListener("click", render);
document.getElementById("challenge").addEventListener("click", () => { host.dataset.fixtureHealth = "security-challenge"; });
render();
