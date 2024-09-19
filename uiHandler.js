export function openTab(tabName) {
	// Hide all tab contents
	const tabContents = document.getElementsByClassName("tabcontent");
	for (let content of tabContents) {
		content.classList.remove("active");
	}

	// Deactivate all tabs
	const tabItems = document.getElementsByClassName("tab-item");
	for (let item of tabItems) {
		item.classList.remove("active");
	}

	// Show the selected tab content
	document.getElementById(tabName).classList.add("active");

	// Activate the correct tab
	let activeTabId;
	switch (tabName) {
		case "upcomingContent":
			activeTabId = "viewTab";
			break;
		case "settingsContent":
			activeTabId = "settingsTab";
			break;
		default:
			activeTabId = "scheduleTab";
	}
	document.getElementById(activeTabId).classList.add("active");
}

export function updateSortButtonText(sortBy, sortOrder) {
	const sortButton = document.getElementById("sortButton");
	const selectedOption = document.querySelector(`#sortDropdown a[data-sort="${sortBy}"][data-order="${sortOrder}"]`);
	if (selectedOption) {
		sortButton.innerHTML = `<span class="sort-icon">&#x25BE;</span> Sort: ${selectedOption.textContent}`;
	}
}

export function toggleDropdown() {
	document.getElementById("sortDropdown").classList.toggle("show");
}

export function showAlert(message) {
	const alertDiv = document.getElementById("customAlert");
	const alertContent = document.getElementById("alertContent");
	const okButton = document.getElementById("alertOk");

	alertContent.textContent = message;

	// Check if dark mode is active and apply the class to the alert
	if (document.body.classList.contains("dark-mode")) {
		alertDiv.classList.add("dark-mode");
	} else {
		alertDiv.classList.remove("dark-mode");
	}

	alertDiv.style.display = "flex";

	okButton.onclick = function () {
		alertDiv.style.display = "none";
	};
}

export function toggleDarkMode() {
	const isDarkMode = document.body.classList.toggle("dark-mode");

	switchToDarkModeUI(isDarkMode);

	// Save dark mode preference
	chrome.storage.sync.set({ darkMode: isDarkMode });
}

function switchToDarkModeUI(isDarkMode) {
	const darkModeToggle = document.getElementById("darkModeToggle");

	// Update button text
	darkModeToggle.textContent = isDarkMode ? "Toggle Light Mode" : "Toggle Dark Mode";

	// Switch icons
	switchIconMode(isDarkMode);
}

export function switchIconMode(isDarkMode) {
	const lightIcons = document.querySelectorAll(".light-icon");
	const darkIcons = document.querySelectorAll(".dark-icon");

	lightIcons.forEach((icon) => (icon.style.display = isDarkMode ? "none" : "inline-block"));
	darkIcons.forEach((icon) => (icon.style.display = isDarkMode ? "inline-block" : "none"));
}
