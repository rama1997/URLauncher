export function validateInput(title, url, time) {
	const result = {
		isValid: true,
		errors: [],
	};

	// Validate title
	if (typeof title !== "string" || title.trim() === "") {
		result.isValid = false;
		result.errors.push("Please enter a title");
		return result;
	}

	// Validate URL
	try {
		new URL(url);
	} catch (_) {
		result.isValid = false;
		result.errors.push("Please enter a valid URL including the protocol (e.g., http:// or https://)");
		return result;
	}

	// Validate time
	const timeDate = new Date(time);
	const now = new Date();
	if (isNaN(timeDate.getTime())) {
		result.isValid = false;
		result.errors.push("Please enter a valid time");
		return result;
	} else if (timeDate <= now) {
		result.isValid = false;
		result.errors.push("The scheduled time must be in the future");
		return result;
	}

	return result;
}

// Helper function to format date for datetime-local input
export function formatDateTimeForInput(date) {
	const year = date.getFullYear();
	const month = (date.getMonth() + 1).toString().padStart(2, "0");
	const day = date.getDate().toString().padStart(2, "0");
	const hours = date.getHours().toString().padStart(2, "0");
	const minutes = date.getMinutes().toString().padStart(2, "0");

	return `${year}-${month}-${day}T${hours}:${minutes}`;
}
