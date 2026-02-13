#!/bin/bash
# AI SDR Cron Job Script
# Run this script daily to collect and process leads

# Change to the project directory
cd "$(dirname "$0")"

# Log file
LOG_FILE="/var/log/ai_sdr.log"

# Ensure log file exists
sudo touch "$LOG_FILE"
sudo chown $(whoami) "$LOG_FILE"

# Log start
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting AI SDR pipeline..." >> "$LOG_FILE"

# Check if node is available
if ! command -v node &> /dev/null; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Node.js not found" >> "$LOG_FILE"
    exit 1
fi

# Run the full pipeline
node pipeline/full_pipeline.js >> "$LOG_FILE" 2>&1

# Check result
if [ $? -eq 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Pipeline completed successfully" >> "$LOG_FILE"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Pipeline failed" >> "$LOG_FILE"
fi

echo "---" >> "$LOG_FILE"
