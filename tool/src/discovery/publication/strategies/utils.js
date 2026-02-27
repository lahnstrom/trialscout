/**
 * Parses PubMed's date format to ISO date string
 * @param {string} pubDateString - Date string in format "YYYY/MM/DD HH:MM"
 * @returns {string|null} ISO date string "YYYY-MM-DD" or null if invalid
 */
export const parsePubDate = (pubDateString) => {
  if (!pubDateString) {
    return null;
  }

  try {
    // PubMed format: "1995/03/01 00:00" or "2025/11/01 00:00"
    const datePart = pubDateString.split(" ")[0]; // Get "YYYY/MM/DD"
    const [year, month, day] = datePart.split("/");

    // Validate components exist
    if (!year) {
      return null;
    }

    // Pad month and day with leading zeros if needed
    const paddedMonth = month ? month.padStart(2, "0") : "";
    const paddedDay = day ? day.padStart(2, "0") : "";

    // Build ISO date string
    let isoDate = year;
    if (paddedMonth) {
      isoDate += `-${paddedMonth}`;
      if (paddedDay) {
        isoDate += `-${paddedDay}`;
      }
    }

    return isoDate;
  } catch (error) {
    console.error(`Failed to parse pubDate: ${pubDateString}`, error);
    return null;
  }
};
