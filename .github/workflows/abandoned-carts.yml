name: Abandoned carts report
on:
  schedule:
    - cron: "30 2 * * *"    # daily   08:00 IST -> trailing 7 days
    - cron: "0 3 * * 1"     # weekly  08:30 IST Monday -> previous Mon-Sun
    - cron: "30 3 1 * *"    # monthly 09:00 IST on the 1st -> previous month
  workflow_dispatch:
    inputs:
      period:
        description: "daily | weekly | monthly"
        default: "weekly"
        required: true
jobs:
  report:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install requests pandas openpyxl
      - name: Pick period
        id: p
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then echo "period=${{ inputs.period }}" >> "$GITHUB_OUTPUT"
          elif [ "${{ github.event.schedule }}" = "30 3 1 * *" ]; then echo "period=monthly" >> "$GITHUB_OUTPUT"
          elif [ "${{ github.event.schedule }}" = "0 3 * * 1" ]; then echo "period=weekly" >> "$GITHUB_OUTPUT"
          else echo "period=daily" >> "$GITHUB_OUTPUT"; fi
      - name: Run report
        env:
          SHOPIFY_STORE: shopmulmul.myshopify.com
          SHOPIFY_TOKEN: ${{ secrets.SHOPIFY_ACCESS_TOKEN }}
        run: python scripts/abandoned_carts_report.py --period ${{ steps.p.outputs.period }} --out reports/abandoned-carts
      - name: Commit report
        run: |
          git config user.name mulmulos-bot
          git config user.email bot@mulmul.local
          git add reports/abandoned-carts
          git commit -m "abandoned carts: ${{ steps.p.outputs.period }} $(date -u +%F)" || exit 0
          git push
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: abandoned-carts-${{ steps.p.outputs.period }}
          path: reports/abandoned-carts/*.xlsx
