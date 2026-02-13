#!/bin/bash
# Setup script for AI SDR cron job

echo "Setting up AI SDR cron job..."

# Get the project directory
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CRON_LINE="0 9 * * * $PROJECT_DIR/cron.sh >> /var/log/ai_sdr.log 2>&1"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "ai_sdr"; then
    echo "Cron job already exists."
    echo "Current cron jobs:"
    crontab -l | grep "ai_sdr"
    
    read -p "Do you want to update it? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled."
        exit 0
    fi
    
    # Remove existing cron job
    crontab -l 2>/dev/null | grep -v "ai_sdr" | crontab -
fi

# Add new cron job
(crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -

echo "✅ Cron job installed successfully!"
echo "The pipeline will run daily at 9:00 AM."
echo ""
echo "To verify, run: crontab -l"
echo "To manually run the pipeline: $PROJECT_DIR/cron.sh"
