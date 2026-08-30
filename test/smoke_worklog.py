"""Smoke test for the standalone Jira worklog page."""
from support.smoke import run_page_contract


if __name__ == "__main__":
    run_page_contract(
        "Jira worklog",
        page="pages/worklog/worklog.html",
        html=['id="logTableBody"', 'id="addRow"', 'id="sendAll"', 'id="clearSent"', 'id="authDot"'],
        sources={
            "pages/worklog/worklog.js": [
                "function saveToStorage()", "function renderTable()",
                "async function checkJiraAuth()", "sendAllBtn.onclick = async",
                "function confirmWorklogAction(message)", "clearSentBtn.onclick = async",
            ],
        },
    )
