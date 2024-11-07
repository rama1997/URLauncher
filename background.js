// State management
let state = {
	alarms: [],
};

// Listen for extension installation or update
chrome.runtime.onInstalled.addListener(() => {
	loadAlarmRecord().catch((error) => {
		console.error("Error during installation:", error);
	});
});

// listener for when Chrome starts up
chrome.runtime.onStartup.addListener(() => {
	checkAndReschedulePassedAlarms().catch((error) => {
		console.error("Error during startup:", error);
	});
});

// Handle alarms
chrome.alarms.onAlarm.addListener((alarm) => {
	handleAlarm(alarm).catch((error) => {
		console.error("Error in alarm listener:", error);
	});
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	switch (request.action) {
		case "getRecord":
			loadAlarmRecord()
				.then((state) => sendResponse(state))
				.catch(() => sendResponse({ state }));
			break;
		case "scheduleURL":
			createAlarm(request.alarm)
				.then(() => sendResponse({ success: true }))
				.catch(() => sendResponse({ success: false }));
			break;
		case "deleteAlarm":
			deleteAlarm(request.alarm)
				.then(() => sendResponse({ success: true }))
				.catch(() => sendResponse({ success: false }));
			break;
		case "editAlarm":
			editAlarm(request.alarm)
				.then(() => sendResponse({ success: true }))
				.catch(() => sendResponse({ success: false }));
			break;
		case "toggleAlarm":
			toggleAlarm(request.id)
				.then(() => sendResponse({ success: true }))
				.catch(() => sendResponse({ success: false }));
			break;
	}
	return true;
});

// Helper function to promisify chrome.alarms.clear
function clearChromeAlarm(alarmId) {
	return new Promise((resolve, reject) => {
		chrome.alarms.clear(alarmId, () => {
			if (chrome.runtime.lastError) {
				reject(chrome.runtime.lastError);
			} else {
				resolve();
			}
		});
	});
}

// Helper function to promisify chrome.alarms.create
function createChromeAlarm(alarmId, alarmInfo) {
	return new Promise((resolve, reject) => {
		chrome.alarms.create(alarmId, alarmInfo, () => {
			if (chrome.runtime.lastError) {
				reject(chrome.runtime.lastError);
			} else {
				resolve();
			}
		});
	});
}

// Helper function to promisify chrome.storage.local.get
function getChromeStorageData(key) {
	return new Promise((resolve, reject) => {
		chrome.storage.local.get(key, (result) => {
			if (chrome.runtime.lastError) {
				reject(chrome.runtime.lastError);
			} else {
				resolve(result);
			}
		});
	});
}

// Helper function to promisify chrome.storage.local.set
function setChromeStorageData(data) {
	return new Promise((resolve, reject) => {
		chrome.storage.local.set(data, () => {
			if (chrome.runtime.lastError) {
				reject(chrome.runtime.lastError);
			} else {
				resolve();
			}
		});
	});
}

async function createAlarm(alarm) {
	try {
		// Clear any existing alarm with the same ID
		await clearChromeAlarm(alarm.id);

		// Create the new alarm in Chrome
		const alarmTime = new Date(alarm.time).getTime();
		await createChromeAlarm(alarm.id, { when: alarmTime });

		// Update the alarm in storage
		const result = await getChromeStorageData(["alarms"]);
		const alarms = result.alarms || [];

		const index = alarms.findIndex((a) => a.id === alarm.id);
		if (index !== -1) {
			alarms[index] = alarm;
		} else {
			alarms.push(alarm);
		}

		await setChromeStorageData({ alarms });

		// Refresh the popup
		refreshPopup();
	} catch (error) {
		console.error("Error creating alarm", error);
	}
}

async function deleteAlarm(alarmToBeDeleted) {
	try {
		// Delete alarm from Chrome
		await clearChromeAlarm(alarmToBeDeleted.id);

		// Delete alarm from storage
		const result = await getChromeStorageData(["alarms"]);
		const alarms = result.alarms || [];

		const updatedAlarms = alarms.filter((alarm) => alarm.id !== alarmToBeDeleted.id);

		await setChromeStorageData({ alarms: updatedAlarms });

		// Refresh the popup
		refreshPopup();
	} catch (error) {
		console.error("Error deleting alarm:", error);
	}
}

async function editAlarm(updatedAlarm) {
	try {
		const result = await getChromeStorageData(["alarms"]);
		const alarms = result.alarms || [];

		const index = alarms.findIndex((alarm) => alarm.id === updatedAlarm.id);
		if (index !== -1) {
			const oldAlarm = alarms[index];
			await deleteAlarm(oldAlarm);
			alarms[index] = updatedAlarm;
			await createAlarm(updatedAlarm);
		} else {
			throw new Error("Alarm not found for editing");
		}
	} catch (error) {
		console.error("Error editing alarm:", error);
	}
}

async function handleAlarm(triggeredAlarm) {
	try {
		const result = await getChromeStorageData(["alarms"]);
		const alarms = result.alarms || [];
		const alarm = alarms.find((a) => a.id === triggeredAlarm.name);

		if (alarm) {
			if (alarm.isActive) {
				createChromeTabWithURL(alarm.url);

				if (alarm.frequency === "once") {
					await deleteAlarm(alarm);
				} else {
					await updateAlarm(alarm);
				}
			} else {
				if (alarm.frequency !== "once") {
					await updateAlarm(alarm);
				}
			}
		}

		refreshPopup();
	} catch (error) {
		console.error("Error handling alarm:", error);
	}
}

async function toggleAlarm(id) {
	try {
		const result = await getChromeStorageData(["alarms"]);
		const alarms = result.alarms || [];
		const alarm = alarms.find((alarm) => alarm.id === id);

		if (alarm) {
			alarm.isActive = !alarm.isActive;
			await setChromeStorageData({ alarms });

			if (alarm.isActive) {
				await updateAlarm(alarm);
			} else {
				refreshPopup();
			}
		} else {
			throw new Error("Alarm not found for toggling");
		}
	} catch (error) {
		console.error("Error toggling alarm:", error);
	}
}

async function updateAlarm(alarm) {
	try {
		const now = new Date();
		const alarmTime = new Date(alarm.time);

		let newTime = new Date(alarmTime);
		while (newTime <= now) {
			newTime = getNextAlarmTime(newTime, alarm.frequency);
		}

		alarm.time = newTime.toISOString();

		await deleteAlarm(alarm);
		await createAlarm(alarm);

		refreshPopup();
	} catch (error) {
		console.error("Error updating alarm:", error);
	}
}

function isScheduledTimePassed(scheduledTime) {
	const now = new Date();
	const scheduled = new Date(scheduledTime);
	return scheduled <= now;
}

// Reschedule alarms that have passed
async function checkAndReschedulePassedAlarms() {
	try {
		const result = await getChromeStorageData(["alarms"]);
		const alarms = result.alarms || [];

		// Use Promise.all to handle multiple alarms concurrently
		await Promise.all(
			alarms.map(async (alarm) => {
				if (isScheduledTimePassed(alarm.time)) {
					await handleAlarm({ name: alarm.id }); // Simulate alarm trigger
				}
			}),
		);
	} catch (error) {
		console.error("Error checking and rescheduling alarms:", error);
		throw error;
	}
}
async function loadAlarmRecord() {
	try {
		const result = await getChromeStorageData(["alarms"]);
		state.alarms = result.alarms || [];
		console.log(state.alarms);
		return state;
	} catch (error) {
		console.error("Error loading alarm record:", error);
	}
}

function getNextAlarmTime(currentTime, frequency) {
	const next = new Date(currentTime);
	switch (frequency) {
		case "once":
			return new Date(next.getTime() + 1000); //Update by 1 second as precaution to prevent infinite loops
		case "1min":
			return new Date(next.getTime() + 60000);
		case "5min":
			return new Date(next.getTime() + 300000);
		case "10min":
			return new Date(next.getTime() + 600000);
		case "15min":
			return new Date(next.getTime() + 900000);
		case "30min":
			return new Date(next.getTime() + 1800000);
		case "hourly":
			return new Date(next.setHours(next.getHours() + 1));
		case "daily":
			return new Date(next.setDate(next.getDate() + 1));
		case "weekly":
			return new Date(next.setDate(next.getDate() + 7));
		case "biweekly":
			return new Date(next.setDate(next.getDate() + 14));
		case "monthly":
			return new Date(next.setMonth(next.getMonth() + 1));
		case "yearly":
			return new Date(next.setFullYear(next.getFullYear() + 1));
		default:
			return next;
	}
}

function createChromeTabWithURL(url) {
	return new Promise((resolve, reject) => {
		chrome.tabs.create({ url }, (tab) => {
			if (chrome.runtime.lastError) {
				reject(chrome.runtime.lastError);
			} else {
				resolve(tab);
			}
		});
	});
}

// Utility function for refreshing popup
async function refreshPopup() {
	try {
		await new Promise((resolve, reject) => {
			chrome.runtime.sendMessage({ action: "refreshPopup" }, (response) => {
				if (chrome.runtime.lastError) {
					reject(chrome.runtime.lastError);
				} else {
					resolve(response);
				}
			});
		});
	} catch (error) {
		console.error("Error refreshing popup:", error);
	}
}
