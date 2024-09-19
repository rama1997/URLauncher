// State management
let state = {
	alarms: [],
};

// Locking mechanism
let isLocked = false;
let lockQueue = [];

// Function to acquire the lock
function acquireLock(callback) {
	if (!isLocked) {
		isLocked = true;
		callback();
	} else {
		lockQueue.push(callback);
	}
}

// Function to release the lock
function releaseLock() {
	isLocked = false;
	if (lockQueue.length > 0) {
		const nextCallback = lockQueue.shift();
		acquireLock(nextCallback);
	}
}

// Listen for extension installation or update
chrome.runtime.onInstalled.addListener(() => {
	loadAlarmRecord();
});

// listener for when Chrome starts up
chrome.runtime.onStartup.addListener(() => {
	checkAndReschedulePassedAlarms();
});

// Handle alarms
chrome.alarms.onAlarm.addListener((alarm) => {
	handleAlarm(alarm);
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	switch (request.action) {
		case "getRecord":
			loadAlarmRecord(() => {
				sendResponse(state);
			});
			break;
		case "scheduleURL":
			createAlarm(request.alarm);
			sendResponse({ success: true });
			break;
		case "deleteAlarm":
			deleteAlarm(request.alarm);
			sendResponse({ success: true });
			break;
		case "editAlarm":
			editAlarm(request.alarm);
			sendResponse({ success: true });
			break;
		case "toggleAlarm":
			toggleAlarm(request.id);
			sendResponse({ success: true });
			break;
	}
	return true;
});

function createAlarm(alarm) {
	acquireLock(() => {
		// Create Alarm in Chrome
		chrome.alarms.clear(alarm.id, () => {
			if (chrome.runtime.lastError) {
				lastError = chrome.runtime.lastError;
			} else {
				const alarmTime = new Date(alarm.time).getTime();
				chrome.alarms.create(alarm.id, { when: alarmTime }, () => {
					if (chrome.runtime.lastError) {
						lastError = chrome.runtime.lastError;
					} else {
						// Create alarm in records
						chrome.storage.local.get(["alarms"], (result) => {
							if (chrome.runtime.lastError) {
								lastError = chrome.runtime.lastError;
							} else {
								const alarms = result.alarms || [];
								const index = alarms.findIndex((a) => a.id === alarm.id);
								if (index !== -1) {
									alarms[index] = alarm;
								} else {
									alarms.push(alarm);
								}
								chrome.storage.local.set({ alarms }, () => {
									refreshPopup();
								});
							}
						});
					}
				});
			}
		});
		releaseLock();
	});
}

function deleteAlarm(alarmToBeDeleted) {
	acquireLock(() => {
		// Delete alarm from Chrome
		chrome.alarms.clear(alarmToBeDeleted.id, () => {
			if (chrome.runtime.lastError) {
				lastError = chrome.runtime.lastError;
			}

			// Delete alarm from records
			chrome.storage.local.get(["alarms"], (result) => {
				if (chrome.runtime.lastError) {
					lastError = chrome.runtime.lastError;
				} else {
					const alarms = result.alarms || [];
					const updatedAlarms = alarms.filter((alarm) => alarm.id !== alarmToBeDeleted.id);
					chrome.storage.local.set({ alarms: updatedAlarms }, () => {
						if (chrome.runtime.lastError) {
							lastError = chrome.runtime.lastError;
						} else {
							refreshPopup();
						}
					});
				}
			});
			releaseLock();
		});
	});
}

function editAlarm(updatedAlarm) {
	chrome.storage.local.get(["alarms"], (result) => {
		if (chrome.runtime.lastError) {
			lastError = chrome.runtime.lastError;
		} else {
			const alarms = result.alarms || [];
			const index = alarms.findIndex((alarm) => alarm.id === updatedAlarm.id);
			if (index !== -1) {
				const oldAlarm = alarms[index];
				deleteAlarm(oldAlarm);
				alarms[index] = updatedAlarm;
				createAlarm(updatedAlarm);
			}
		}
	});
}

function handleAlarm(triggeredAlarm) {
	acquireLock(() => {
		chrome.storage.local.get(["alarms"], (result) => {
			if (chrome.runtime.lastError) {
				lastError = chrome.runtime.lastError;
			} else {
				const alarms = result.alarms || [];
				const alarm = alarms.find((a) => a.id === triggeredAlarm.name);
				if (alarm) {
					if (alarm.isActive) {
						openURL(alarm.url);
						if (alarm.frequency === "once") {
							deleteAlarm(alarm);
						} else {
							updateAlarm(alarm);
						}
					} else {
						if (alarm.frequency !== "once") {
							updateAlarm(alarm);
						}
					}
				}
			}
			refreshPopup();
			releaseLock();
		});
	});
}

function toggleAlarm(id) {
	acquireLock(() => {
		chrome.storage.local.get(["alarms"], (result) => {
			if (chrome.runtime.lastError) {
				lastError = chrome.runtime.lastError;
			} else {
				const alarms = result.alarms || [];
				const alarm = alarms.find((alarm) => alarm.id === id);
				if (alarm) {
					alarm.isActive = !alarm.isActive;
					chrome.storage.local.set({ alarms }, () => {
						if (chrome.runtime.lastError) {
							lastError = chrome.runtime.lastError;
						} else {
							if (alarm.isActive) {
								updateAlarm(alarm);
							} else {
								refreshPopup();
							}
						}
					});
				}
			}
			releaseLock();
		});
	});
}

function updateAlarm(alarm) {
	acquireLock(() => {
		const now = new Date();
		const alarmTime = new Date(alarm.time);

		let newTime = new Date(alarmTime);
		while (newTime <= now) {
			newTime = getNextAlarmTime(newTime, alarm.frequency);
		}

		alarm.time = newTime.toISOString();

		deleteAlarm(alarm);
		createAlarm(alarm);

		refreshPopup();
		releaseLock();
	});
}

function isScheduledTimePassed(scheduledTime) {
	const now = new Date();
	const scheduled = new Date(scheduledTime);
	return scheduled <= now;
}

// Reschedule alarms that have passed
function checkAndReschedulePassedAlarms() {
	chrome.storage.local.get(["alarms"], (result) => {
		if (chrome.runtime.lastError) {
			lastError = chrome.runtime.lastError;
		} else {
			const alarms = result.alarms || [];
			alarms.forEach((alarm) => {
				if (isScheduledTimePassed(alarm.time)) {
					handleAlarm(alarm);
				}
			});
		}
	});
}

function loadAlarmRecord(callback) {
	chrome.storage.local.get(["alarms"], (result) => {
		if (chrome.runtime.lastError) {
			lastError = chrome.runtime.lastError;
		} else {
			state.alarms = result.alarms || [];
		}
		if (callback) callback();
	});
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

function openURL(url) {
	chrome.tabs.create({ url: url }, (tab) => {
		if (chrome.runtime.lastError) {
			lastError = chrome.runtime.lastError;
		}
	});
}

function refreshPopup() {
	chrome.runtime.sendMessage({ action: "refreshPopup" }, (response) => {
		if (chrome.runtime.lastError) {
			lastError = chrome.runtime.lastError;
		}
	});
}
