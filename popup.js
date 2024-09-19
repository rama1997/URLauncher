import * as UI from "./uiHandler.js";
import * as Utils from "./utils.js";

let state = {};

// Global variable to track sort order
let currentSortBy = "title";
let currentSortOrder = "asc";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.action === "refreshPopup") {
		loadState();
		sendResponse({ success: true });
	}
});

document.addEventListener("DOMContentLoaded", function () {
	setupEventListeners();
	loadState();

	// Set initial active tab
	document.getElementById("scheduleContent").classList.add("active");
	document.getElementById("scheduleTab").classList.add("active");
});

function setupEventListeners() {
	// Event Listners for buttons and tabs
	document.getElementById("scheduleButton").addEventListener("click", scheduleURL);
	document.getElementById("scheduleTab").addEventListener("click", () => UI.openTab("scheduleContent"));
	document.getElementById("viewTab").addEventListener("click", () => UI.openTab("upcomingContent"));
	document.getElementById("settingsTab").addEventListener("click", () => UI.openTab("settingsContent"));
	document.getElementById("feedbackForm").addEventListener("submit", submitFeedback);

	setupSortDropdown();
	setupDarkMode();
}

function setupSortDropdown() {
	const sortButton = document.getElementById("sortButton");
	const sortDropdown = document.getElementById("sortDropdown");

	sortButton.addEventListener("click", UI.toggleDropdown);

	// Retrieve and apply stored sort preference
	chrome.storage.local.get(["sortBy", "sortOrder"], function (result) {
		if (result.sortBy && result.sortOrder) {
			currentSortBy = result.sortBy;
			currentSortOrder = result.sortOrder;
			UI.updateSortButtonText(currentSortBy, currentSortOrder);
			viewScheduledURLs();
		}
	});

	// Handle sort option click
	document.querySelectorAll("#sortDropdown a").forEach((option) => {
		option.addEventListener("click", (event) => {
			event.preventDefault();
			currentSortBy = event.target.getAttribute("data-sort");
			currentSortOrder = event.target.getAttribute("data-order");

			// Store the new sort preference
			chrome.storage.local.set({
				sortBy: currentSortBy,
				sortOrder: currentSortOrder,
			});

			viewScheduledURLs();
			UI.updateSortButtonText(currentSortBy, currentSortOrder);
			UI.toggleDropdown();
		});
	});

	// Close the dropdown when clicking outside
	document.addEventListener("click", (event) => {
		if (!event.target.matches("#sortButton")) {
			sortDropdown.classList.remove("show");
		}
	});
}

function setupDarkMode() {
	// Dark mode toggle
	const darkModeToggle = document.getElementById("darkModeToggle");
	darkModeToggle.addEventListener("click", UI.toggleDarkMode);

	// Load saved dark mode preference
	chrome.storage.sync.get("darkMode", function (data) {
		if (data.darkMode) {
			document.body.classList.add("dark-mode");
			document.getElementById("darkModeToggle").textContent = "Toggle Light Mode";
			UI.switchIconMode(true);
		}
	});
}

function loadState() {
	chrome.runtime.sendMessage({ action: "getRecord" }, (response) => {
		if (chrome.runtime.lastError) {
			UI.showAlert("Error loading data. Please try again.");
			return;
		}

		if (response && typeof response === "object") {
			state = response;
			state.alarms = state.alarms || []; // Ensure alarms is always an array
		} else {
			UI.showAlert("Invalid data. Please try again.");
			state = { alarms: [] }; // Set a default state
		}
		updatePopupDisplay();
	});
}

function updatePopupDisplay() {
	viewScheduledURLs();
}

function scheduleURL() {
	const titleInput = document.getElementById("titleInput");
	const urlInput = document.getElementById("urlInput");
	const timeInput = document.getElementById("timeInput");
	const frequencyInput = document.getElementById("frequencyInput");

	const inputValidationResult = Utils.validateInput(titleInput.value, urlInput.value, timeInput.value);

	if (inputValidationResult.isValid) {
		const newAlarm = {
			id: Date.now().toString(),
			title: titleInput.value,
			url: urlInput.value,
			time: timeInput.value,
			frequency: frequencyInput.value,
			isActive: true,
		};

		chrome.runtime.sendMessage({ action: "scheduleURL", alarm: newAlarm }, (response) => {
			// Reset user input fields on successful schedule
			if (response && response.success) {
				UI.showAlert("URL scheduled successfully!");
				titleInput.value = "";
				urlInput.value = "";
				timeInput.value = "";
				frequencyInput.value = "once";
				loadState();
			} else {
				UI.showAlert("Failed to schedule URL. Please try again.");
			}
		});
	} else {
		UI.showAlert(inputValidationResult.errors.join("\n"));
	}
}

function viewScheduledURLs() {
	const scheduledList = document.getElementById("scheduledList");
	scheduledList.innerHTML = ""; // Clear the list

	if (!state.alarms || state.alarms.length === 0) {
		scheduledList.innerHTML = '<p class="no-schedules">No scheduled URLs.</p>';
	} else {
		const sortedAlarms = sortScheduledURLs(state.alarms, currentSortBy, currentSortOrder);
		sortedAlarms.forEach(renderAlarm);
	}
}

function renderAlarm(alarm) {
	const scheduledList = document.getElementById("scheduledList");
	const scheduleItem = document.createElement("div");
	scheduleItem.className = "schedule-item";
	const nextAlarmTime = new Date(alarm.time);

	scheduleItem.innerHTML = `
    <button class="delete-btn" data-id="${alarm.id}">&times;</button>
    <h3 class="schedule-title" title="${alarm.title}">${alarm.title}</h3>
    <p class="schedule-url" title="${alarm.url}">${alarm.url}</p>
    <p class="schedule-time" title="${nextAlarmTime.toLocaleString()}">Next: ${nextAlarmTime.toLocaleString()}</p>
    <p class="schedule-frequency">Frequency: ${alarm.frequency}</p>
    <button class="edit-btn" data-id="${alarm.id}">✎</button>
    <button class="toggle-btn ${alarm.isActive ? "active" : ""}" data-id="${alarm.id}">${alarm.isActive ? "Active" : "Inactive"}</button>
    <div class="edit-form" style="display:none;">
      <input type="text" class="edit-title" value="${alarm.title}">
      <input type="url" class="edit-url" value="${alarm.url}">
      <input type="datetime-local" class="edit-time" value="${Utils.formatDateTimeForInput(nextAlarmTime)}">
      <select class="edit-frequency styled-select">${generateFrequencyOptions(alarm.frequency)}</select>
      <button class="save-btn">Save</button>
      <button class="cancel-btn">Cancel</button>
    </div>
  `;
	scheduledList.appendChild(scheduleItem);

	scheduleItem.querySelector(".delete-btn").addEventListener("click", deleteScheduledURL);
	scheduleItem.querySelector(".edit-btn").addEventListener("click", editScheduledURL);
	scheduleItem.querySelector(".toggle-btn").addEventListener("click", toggleAlarmState);
	scheduleItem.querySelector(".save-btn").addEventListener("click", saveEdit);
	scheduleItem.querySelector(".cancel-btn").addEventListener("click", cancelEdit);
}

function generateFrequencyOptions(selectedFrequency) {
	const frequencies = [
		{ value: "once", label: "Once" },
		{ value: "1min", label: "Every minute" },
		{ value: "5min", label: "Every 5 minutes" },
		{ value: "10min", label: "Every 10 minutes" },
		{ value: "15min", label: "Every 15 minutes" },
		{ value: "30min", label: "Every 30 minutes" },
		{ value: "hourly", label: "Every hour" },
		{ value: "daily", label: "Every day" },
		{ value: "weekly", label: "Every week" },
		{ value: "biweekly", label: "Every two weeks" },
		{ value: "monthly", label: "Every month" },
		{ value: "yearly", label: "Every year" },
	];

	return frequencies.map((freq) => `<option value="${freq.value}" ${freq.value === selectedFrequency ? "selected" : ""}>${freq.label}</option>`).join("");
}

function sortScheduledURLs(alarms, sortBy, sortOrder) {
	return alarms.sort((a, b) => {
		if (sortBy === "title") {
			const comparison = a.title.localeCompare(b.title, undefined, {
				sensitivity: "base",
			});
			return sortOrder === "asc" ? comparison : -comparison;
		} else if (sortBy === "time") {
			const timeA = new Date(a.time).getTime();
			const timeB = new Date(b.time).getTime();
			return sortOrder === "asc" ? timeA - timeB : timeB - timeA;
		}
	});
}

function editScheduledURL(event) {
	const item = event.target.closest(".schedule-item");
	const editForm = item.querySelector(".edit-form");
	editForm.style.display = "block";
	item.querySelector(".schedule-title").style.display = "none";
	item.querySelector(".schedule-url").style.display = "none";
	item.querySelector(".schedule-time").style.display = "none";
	item.querySelector(".schedule-frequency").style.display = "none";
	item.querySelector(".edit-btn").style.display = "none";

	// Get the current alarm time from the displayed text
	const currentTimeText = item.querySelector(".schedule-time").title;
	const currentTime = new Date(currentTimeText);

	// Format the date and time for the datetime-local input
	const formattedDateTime = Utils.formatDateTimeForInput(currentTime);

	// Set the value of the datetime-local input
	const dateTimeInput = editForm.querySelector(".edit-time");
	dateTimeInput.value = formattedDateTime;

	const saveBtn = editForm.querySelector(".save-btn");
	const cancelBtn = editForm.querySelector(".cancel-btn");

	saveBtn.addEventListener("click", saveEdit);
	cancelBtn.addEventListener("click", cancelEdit);
}

function saveEdit(event) {
	const item = event.target.closest(".schedule-item");
	const id = item.querySelector(".delete-btn").getAttribute("data-id");
	const newTitle = item.querySelector(".edit-title").value;
	const newUrl = item.querySelector(".edit-url").value;
	const newTime = new Date(item.querySelector(".edit-time").value);
	const newFrequency = item.querySelector(".edit-frequency").value;

	const inputValidationResult = Utils.validateInput(newTitle, newUrl, newTime);

	if (inputValidationResult.isValid) {
		const updatedAlarm = {
			id: id,
			title: newTitle,
			url: newUrl,
			time: newTime,
			frequency: newFrequency,
			isActive: true, // Assume it's active when edited
		};

		chrome.runtime.sendMessage({ action: "editAlarm", alarm: updatedAlarm }, (response) => {
			if (response && response.success) {
				UI.showAlert("URL edited successfully!");
				loadState();
			} else {
				UI.showAlert("Failed to edit URL. Please try again.");
			}
		});
	} else {
		UI.showAlert(inputValidationResult.errors.join("\n"));
	}
}

function cancelEdit(event) {
	const item = event.target.closest(".schedule-item");
	item.querySelector(".edit-form").style.display = "none";
	item.querySelector(".schedule-title").style.display = "block";
	item.querySelector(".schedule-url").style.display = "block";
	item.querySelector(".schedule-time").style.display = "block";
	item.querySelector(".schedule-frequency").style.display = "block";
	item.querySelector(".edit-btn").style.display = "inline-block";
}

function toggleAlarmState(event) {
	const id = event.target.getAttribute("data-id");
	chrome.runtime.sendMessage({ action: "toggleAlarm", id: id }, (response) => {
		if (response && response.success) {
			loadState();
		} else {
			UI.showAlert("Failed to toggle alarm state. Please try again.");
		}
	});
}

function deleteScheduledURL(event) {
	const alarmId = event.target.getAttribute("data-id");
	const alarmToDelete = state.alarms.find((alarm) => alarm.id === alarmId);

	if (alarmToDelete) {
		chrome.runtime.sendMessage({ action: "deleteAlarm", alarm: alarmToDelete }, (response) => {
			if (response && response.success) {
				UI.showAlert("URL deleted successfully!");
				loadState();
			} else {
				UI.showAlert("Failed to delete URL. Please try again.");
			}
		});
	}
}

function submitFeedback(event) {
	event.preventDefault();
	const feedbackText = document.getElementById("feedbackText").value.trim();
	const feedbackMessage = document.getElementById("feedbackMessage");

	if (feedbackText) {
		// Prepare data for the API request
		const serviceID = "service_ojcphrh";
		const templateID = "template_cru3heo";
		const userID = "DC_07f9TUujmj5896";

		const templateParams = {
			feedback: feedbackText,
		};

		// Send feedback via EmailJS API using Fetch
		fetch(`https://api.emailjs.com/api/v1.0/email/send`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				service_id: serviceID,
				template_id: templateID,
				user_id: userID,
				template_params: templateParams,
			}),
		})
			.then((response) => {
				if (response.ok) {
					// Clear the textarea and show a success message
					document.getElementById("feedbackText").value = "";
					feedbackMessage.textContent = "Thank you for your feedback!";
					feedbackMessage.style.color = "green";

					// Clear the success message after 3 seconds
					setTimeout(() => {
						feedbackMessage.textContent = "";
					}, 3000);
				} else {
					throw new Error("Failed to send feedback");
				}
			})
			.catch((error) => {
				feedbackMessage.textContent = "Failed to send feedback. Please try again.";
				feedbackMessage.style.color = "red";
			});
	} else {
		feedbackMessage.textContent = "Please enter your feedback before submitting.";
		feedbackMessage.style.color = "red";
	}
}
