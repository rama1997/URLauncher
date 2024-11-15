// State management
let state = {
	alarms: [],
};

// Queue management
let operationQueue = [];
let isProcessing = false;

// Chrome event listeners
chrome.runtime.onInstalled.addListener(() => {
	loadAlarmRecord().catch((error) => {
		console.error("Error during installation:", error);
	});
});

chrome.runtime.onStartup.addListener(() => {
	checkAndReschedulePassedAlarms().catch((error) => {
		console.error("Error during startup:", error);
	});
});

chrome.alarms.onAlarm.addListener((alarm) => {
	enqueueOperation(() => handleAlarm(alarm)).catch((error) => {
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
			scheduleURL(request.alarm)
				.then(() => sendResponse({ success: true }))
				.catch(() => sendResponse({ success: false }));
			break;
		case "deleteURL":
			deleteURL(request.alarm)
				.then(() => sendResponse({ success: true }))
				.catch(() => sendResponse({ success: false }));
			break;
		case "editURL":
			editURL(request.alarm)
				.then(() => sendResponse({ success: true }))
				.catch(() => sendResponse({ success: false }));
			break;
		case "toggleURL":
			toggleURL(request.id)
				.then(() => sendResponse({ success: true }))
				.catch(() => sendResponse({ success: false }));
			break;
	}
	return true;
});

// Helper function to add operation to queue and process
async function enqueueOperation(operation) {
	return new Promise((resolve, reject) => {
		operationQueue.push({
			operation,
			resolve,
			reject,
		});
		processQueue();
	});
}

// Process queue
async function processQueue() {
	if (isProcessing || operationQueue.length === 0) {
		return;
	}

	isProcessing = true;

	while (operationQueue.length > 0) {
		const { operation, resolve, reject } = operationQueue[0];

		try {
			const result = await operation();
			resolve(result);
		} catch (error) {
			reject(error);
		} finally {
			operationQueue.shift(); // Remove the processed operation
		}
	}

	isProcessing = false;
}

// Helper function to promisify chrome.alarms.clear
function clearChromeAlarm(alarmId) {
	console.log("Clearing alarm:", alarmId);
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
	console.log("Creating alarm:", alarmId);
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

// Core operations
async function updateStorageAlarms(alarms) {
	await setChromeStorageData({ alarms });
}

async function createAlarmCore(url) {
	await clearChromeAlarm(url.id);
	const alarmTime = new Date(url.time).getTime();
	await createChromeAlarm(url.id, { when: alarmTime });
}

async function deleteAlarmCore(url) {
	await clearChromeAlarm(url.id);
}

async function scheduleURL(url) {
	console.log("Create Alarm");
	try {
		await createAlarmCore(url);

		const result = await getChromeStorageData(["alarms"]);
		const alarms = result.alarms || [];

		const index = alarms.findIndex((a) => a.id === url.id);
		if (index !== -1) {
			alarms[index] = url;
		} else {
			alarms.push(url);
		}

		await updateStorageAlarms(alarms);
		refreshPopup();
	} catch (error) {
		console.error("Error creating alarm", error);
	}
}

async function deleteURL(URLToBeDeleted) {
	console.log("Delete Alarm");
	try {
		// Delete alarm from Chrome
		await deleteAlarmCore(URLToBeDeleted);

		// Delete alarm from storage
		const result = await getChromeStorageData(["alarms"]);
		const alarms = result.alarms || [];
		const updatedAlarms = alarms.filter((a) => a.id !== URLToBeDeleted.id);
		await updateStorageAlarms(updatedAlarms);

		refreshPopup();
	} catch (error) {
		console.error("Error deleting alarm:", error);
	}
}

async function editURL(updatedURL) {
	try {
		const result = await getChromeStorageData(["alarms"]);
		const alarms = result.alarms || [];

		const index = alarms.findIndex((alarm) => alarm.id === updatedURL.id);
		if (index !== -1) {
			const oldAlarm = alarms[index];
			await deleteURL(oldAlarm);
			alarms[index] = updatedURL;
			await scheduleURL(updatedURL);
		} else {
			throw new Error("Alarm not found for editing");
		}
	} catch (error) {
		console.error("Error editing alarm:", error);
	}
}

async function handleAlarm(triggeredAlarm) {
	console.log("Handle Alarm");
	try {
		const result = await getChromeStorageData(["alarms"]);
		const alarms = result.alarms || [];
		const alarm = alarms.find((a) => a.id === triggeredAlarm.name);

		if (alarm) {
			if (alarm.isActive) {
				await createChromeTabWithURL(alarm.url);

				if (alarm.frequency === "once") {
					const updatedAlarms = alarms.filter((a) => a.id !== alarm.id);
					await deleteAlarmCore(alarm);
					await updateStorageAlarms(updatedAlarms);
				} else {
					const now = new Date();
					let newTime = new Date(alarm.time);
					while (newTime <= now) {
						newTime = getNextAlarmTime(newTime, alarm.frequency);
					}

					const updatedAlarm = { ...alarm, time: newTime.toISOString() };
					await deleteAlarmCore(alarm);
					await createAlarmCore(updatedAlarm);

					const index = alarms.findIndex((a) => a.id === alarm.id);
					if (index !== -1) {
						alarms[index] = updatedAlarm;
						await updateStorageAlarms(alarms);
					}
				}
			} else {
				const now = new Date();
				let newTime = new Date(alarm.time);
				while (newTime <= now) {
					newTime = getNextAlarmTime(newTime, alarm.frequency);
				}

				const updatedAlarm = { ...alarm, time: newTime.toISOString() };
				await deleteAlarmCore(alarm);
				await createAlarmCore(updatedAlarm);

				const index = alarms.findIndex((a) => a.id === alarm.id);
				if (index !== -1) {
					alarms[index] = updatedAlarm;
					await updateStorageAlarms(alarms);
				}
			}
		}

		refreshPopup();
	} catch (error) {
		console.error("Error handling alarm:", error);
	}
}

async function toggleURL(id) {
	try {
		console.log("Toggling");
		const result = await getChromeStorageData(["alarms"]);
		const alarms = result.alarms || [];
		const alarm = alarms.find((a) => a.id === id);

		if (alarm) {
			// Toggle active state
			alarm.isActive = !alarm.isActive;

			// Update time if alarm is now active
			if (alarm.isActive) {
				console.log("Updating time from toggle");
				const now = new Date();
				let newTime = new Date(alarm.time);
				if (newTime <= now) {
					while (newTime <= now) {
						newTime = getNextAlarmTime(newTime, alarm.frequency);
					}
					alarm.time = newTime.toISOString();
				}
			}

			await deleteAlarmCore(alarm);
			await createAlarmCore(alarm);
			await updateStorageAlarms(alarms);
			refreshPopup();
		}
	} catch (error) {
		console.error("Error toggling alarm:", error);
	}
}

async function updateNextAlarmTime(url) {
	try {
		const now = new Date();
		const alarmTime = new Date(url.time);

		let newTime = new Date(alarmTime);
		while (newTime <= now) {
			newTime = getNextAlarmTime(newTime, url.frequency);
		}

		const updatedURL = { ...url, time: newTime.toISOString() };
		await deleteAlarmCore(url);
		await createAlarmCore(updatedURL);

		const result = await getChromeStorageData(["alarms"]);
		const alarms = result.alarms || [];
		const index = alarms.findIndex((a) => a.id === url.id);
		if (index !== -1) {
			alarms[index] = updatedURL;
			await updateStorageAlarms(alarms);
		}

		refreshPopup();
	} catch (error) {
		console.error("Error updating alarm:", error);
	}
}

// Reschedule alarms that have passed
async function checkAndReschedulePassedAlarms() {
	try {
		const result = await getChromeStorageData(["alarms"]);
		const alarms = result.alarms || [];

		for (const alarm of alarms) {
			if (isScheduledTimePassed(alarm.time)) {
				await enqueueOperation(() => handleAlarm({ name: alarm.id }));
			}
		}
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
		throw error;
	}
}

function isScheduledTimePassed(scheduledTime) {
	const now = new Date();
	const scheduled = new Date(scheduledTime);
	return scheduled <= now;
}

function getNextAlarmTime(currentTime, frequency) {
	const next = new Date(currentTime);
	switch (frequency) {
		case "once":
			return new Date(next.getTime() + 60000); //Update by 1 min as precaution to prevent infinite loops
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

// Utility function for refreshing popup. Refresh attempts is generally going to throw error due to popup not being open for refresh. Can just ignore as non critical
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
		return;
	}
}
