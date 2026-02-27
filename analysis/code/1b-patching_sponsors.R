library(dplyr)
library(stringr)

# Load the original finalSample.rda
load("./data/finalSample.rda")

# Read the patch file with sponsor data
patch_data <- read.csv("./code/node_script/patch_file_pg.csv")

# Check the structure of both datasets
cat("Original df dimensions:", dim(df), "\n")
cat("Patch data dimensions:", dim(patch_data), "\n")
cat("Original df columns:", paste(colnames(df), collapse = ", "), "\n")
cat("Patch data columns:", paste(colnames(patch_data), collapse = ", "), "\n")

# Check for matching NCT IDs
nct_matches <- sum(df$`NCT Number` %in% patch_data$nct_id)
cat("Number of NCT IDs that match between datasets:", nct_matches, "\n")
cat("Total NCT IDs in original df:", nrow(df), "\n")
cat("Total NCT IDs in patch data:", nrow(patch_data), "\n")

# Check if sponsor data already exists and remove it if it does
patch_cols <- c("sponsor_types", "num_collaborators", "countries", "num_countries",
                "lead_sponsor_type", "first_sponsor_type")
existing_patch_cols <- intersect(patch_cols, colnames(df))
if (length(existing_patch_cols) > 0) {
    cat("Sponsor data already exists in df. Removing old columns:", paste(existing_patch_cols, collapse = ", "), "\n")
    df <- df %>% select(-all_of(existing_patch_cols))
}

# Merge the data using left_join to keep all original records
df_patched <- left_join(df, patch_data, by = c("NCT Number" = "nct_id"))

# Check the results
cat("Patched df dimensions:", dim(df_patched), "\n")
cat("New columns added:", setdiff(colnames(df_patched), colnames(df)), "\n")

# Check how many records got sponsor data
records_with_sponsor_data <- sum(!is.na(df_patched$sponsor_types))
cat("Records with sponsor data:", records_with_sponsor_data, "\n")
cat("Records without sponsor data:", sum(is.na(df_patched$sponsor_types)), "\n")

# Show some sample data
cat("\nSample of patched data:\n")
sample_data <- df_patched %>%
    select(`NCT Number`, sponsor_types, num_collaborators) %>%
    filter(!is.na(sponsor_types)) %>%
    head(10)
print(sample_data)

# Check if "Funder Type" matches the first sponsor type
cat("\n=== VALIDATION: Funder Type vs First Sponsor Type ===\n")

# Extract the first sponsor type from sponsor_types column
df_patched <- df_patched %>%
    mutate(first_sponsor_type = case_when(
        !is.na(sponsor_types) ~ str_extract(sponsor_types, "^[^;]+"),
        TRUE ~ NA_character_
    ))

# Check for matches
matches <- df_patched %>%
    filter(!is.na(`Funder Type`) & !is.na(first_sponsor_type)) %>%
    mutate(types_match = `Funder Type` == lead_sponsor_type)

total_comparisons <- nrow(matches)
matching_count <- sum(matches$types_match, na.rm = TRUE)
mismatch_count <- total_comparisons - matching_count

cat("Total records with both Funder Type and sponsor_types:", total_comparisons, "\n")
cat("Records where Funder Type matches first sponsor type:", matching_count, "\n")
cat("Records where Funder Type does NOT match first sponsor type:", mismatch_count, "\n")
cat("Match percentage:", round((matching_count / total_comparisons) * 100, 2), "%\n")

# Show examples of mismatches if any
if (mismatch_count > 0) {
    cat("\nExamples of mismatches:\n")
    mismatches <- matches %>%
        filter(!types_match) %>%
        select(`NCT Number`, `Funder Type`, first_sponsor_type, sponsor_types) %>%
        head(10)
    print(mismatches)
} else {
    cat("\n✅ All Funder Types match the first sponsor type!\n")
}

# Save the patched data back to finalSample.rda
df <- df_patched
save(df, file = "./data/finalSample.rda")

cat("\n✅ Successfully patched finalSample.rda with sponsor data!\n")
cat("Updated file saved to: ./data/finalSample.rda\n")
