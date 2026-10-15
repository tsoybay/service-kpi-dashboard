# Service KPI Dashboard

A free, no-login web tool that turns a list of repair orders into a clear picture of a service department: how many cars were completed, how long jobs take, and how the work is shared between technicians.

It runs entirely in the browser. Your file is read on your own computer and is never uploaded anywhere.

**Live demo:** _add your GitHub Pages link here_

![Screenshot of the Service KPI Dashboard](screenshot.png)

## What it shows

- **Key numbers:** repair orders completed, cars per working day, average and median turnaround, and the longest turnaround.
- **Cars completed:** a bar chart by day, switching to weeks for long date ranges.
- **Turnaround by service type:** which kinds of jobs take longest.
- **Technicians:** repair orders, share of the work and average turnaround. Click a heading to sort.
- **Longest turnarounds:** the repair orders that took longest, with the technician and service type.
- **Filters:** date range (From and To), technician and service type. Everything recalculates as you change them. A filter with nothing to choose between is switched off: the date filter when all the data is from one day, and the technician or service type filter when the file has only one of them. A line under the filters says why.
- **Day or week bars:** the Cars completed chart starts as days for ranges up to about three months and weeks beyond that, and you can switch between them. Weekly bars need at least two weeks of data, and daily bars are offered for up to a year.
- **Copy summary and Print** for sharing the numbers.

## Try it

To use your own data, press **Upload CSV** or drag a file onto the plate. Press **Download sample CSV (template)** to get a file with the right columns.

To see how the dashboard works first, press **Load sample data**. It is a **fictional shop**: about 300 repair orders over two months and six fictional technicians. Nothing in it describes a real shop, person or customer. The sample is made by code with a fixed seed, so everyone sees the same numbers.

## Sample files to try

Three fictional files are included in this repository, so you can see the dashboard handle different kinds of data. All three are made-up data. To download one, click its name below, then use the **Download raw file** button (the download icon) at the top right of the file view. Then press **Upload CSV** in the dashboard and choose the file.

| File | What it is | What to look for |
|---|---|---|
| [sample-data.csv](sample-data.csv) | The same fictional shop as the **Load sample data** button: 292 repair orders over about two months, six technicians, six service types | Daily bars on the Cars completed chart. Every filter is available. |
| [sample-data-2-small-shop.csv](sample-data-2-small-shop.csv) | A different fictional shop: 548 repair orders over six months, four technicians (T-101 to T-104) and seven service types, including seasonal tire changeovers | Weekly bars, because the range is long. A spring tire rush in April roughly doubles the weekly volume. Switch to **By day**, or filter to April, to see it day by day. |
| [sample-data-3-with-problems.csv](sample-data-3-with-problems.csv) | A small file with deliberate mistakes: 39 rows, of which 6 have problems | A warning that 6 rows were skipped, and 33 repair orders loaded. Open **Data quality** at the bottom of the page for the list. It also uses alternative column names (Tech, Job type) and has an extra Notes column, which the tool recognizes or ignores. Its data covers only 10 days, so **By week** is switched off. |

### What the file with problems contains

Open **Data quality** after loading `sample-data-3-with-problems.csv`. The tool lists every skipped row with its row number and the reason, and it flags the repeated RO number:

| Row | The mistake | What the tool says |
|---|---|---|
| 6 | A date typed month/day/year | Opened "08/05/2026 09:15" is not a valid date (use YYYY-MM-DD HH:MM) |
| 12 | A date with no time of day | Opened "2026-08-06" has no time (use YYYY-MM-DD HH:MM) |
| 18 | A job that finished before it opened | Completed is before Opened |
| 24 | A missing RO number | RO number is empty |
| 30 | A missing completion time | Completed is empty |
| 37 | A date that does not exist (Feb 30) | Opened "2026-02-30 09:00" is not a real date and time |

One RO number also appears twice. That row is still counted, and the tool flags it so you can check for duplicates.

## The CSV file

One row per repair order, with five columns:

| Column | What goes in it | Example |
|---|---|---|
| RO number | The repair order number | 10482 |
| Opened | When the car checked in | 2026-07-06 08:15 |
| Completed | When the work finished | 2026-07-06 13:20 |
| Technician | Name or ID | Technician 3 |
| Service type | The kind of job | Brake service |

Good to know:

- **Other columns are ignored,** so a bigger export from another system can be used as is, as long as it contains these five.
- **Dates need the year first and a time:** `YYYY-MM-DD HH:MM`. Dates like `03/02/2026` are rejected because they could mean two different days. Spreadsheet programs sometimes change date formats when saving, so check the file if rows are skipped.
- **Common alternative column names work,** such as Tech or Job type.
- **French-language Excel files work.** Semicolon separators and accented characters are handled.
- **Bad rows are never dropped silently.** The tool shows how many rows were skipped and lists each one with its row number and the reason, under "Data quality" at the bottom of the page.

## Planned for Version 2: more detailed CSV columns

This version keeps the file to five columns on purpose. Version 2 will add five more columns and the numbers they make possible. The full file will look like this:

```
RO number,Opened,Promised,Completed,Technician,Service type,Billed hours,Clocked hours,Comeback,Rating
```

| Column | What goes in it | Example | What it adds |
|---|---|---|---|
| Promised | When the customer was told the car would be ready | 2026-07-06 14:00 | On-time rate, how late the late orders were, and a list of late orders |
| Billed hours | Flat-rate hours charged to the customer | 2.5 | Technician efficiency, together with Clocked hours |
| Clocked hours | Hours the technician actually worked on the job | 2.1 | Technician efficiency, together with Billed hours |
| Comeback | Y if the car came back for the same problem, otherwise N | N | First-time fix rate, and comeback rate per technician |
| Rating | Optional. Customer rating from 1 to 5 | 5 | Average customer rating |

How the new numbers will be calculated:

- **On-time rate:** the share of repair orders completed at or before the promised time.
- **Technician efficiency:** total billed hours divided by total clocked hours. Above 100% means more hours were billed than the technician spent on the jobs. Shops and trade sources define efficiency and productivity in slightly different ways, so Version 2 will state exactly which definition it uses.
- **First-time fix rate:** the share of repair orders marked N in the Comeback column.

**You can prepare files in this format already.** Version 1 ignores columns it does not use, so a file with all ten columns loads today and will work with Version 2 without changes.

## How each number is calculated

| Number | How |
|---|---|
| Cars per working day | Repair orders completed, divided by the number of days that had at least one completion. Days when the shop was closed do not pull the average down. |
| Turnaround | Completed minus Opened, in calendar hours, so nights and weekends count. The median is the middle value, which a few very long jobs do not distort. |
| Share of orders | A technician's repair orders as a share of all the repair orders shown. |

## Limitations

- **Turnaround is calendar time, not shop-hours time.** A car dropped off Friday evening and finished Monday morning includes the weekend.
- **Technician turnaround is not technician speed.** It includes time spent waiting in the queue and waiting for parts, so it describes how work flows through the shop, not how fast each person works.
- **No on-time rate, first-time fix rate or technician efficiency.** Those need more columns (promised time, comebacks, billed and clocked hours). They are planned for Version 2, described above. This version keeps the file to five columns on purpose.
- **Not tested with real dealership exports.** It was tested with generated sample data and hand-made files. Exports from dealership management systems differ, so a real file may need its columns renamed or its dates reformatted first.

## Tech

Plain HTML, CSS and JavaScript. No framework, no libraries, no build step, and no network calls. The charts are drawn with plain SVG.

```
service-kpi-dashboard/
├── index.html        page structure
├── style.css         styling
├── script.js         CSV reading, calculations, sample data, charts
├── sample-data.csv                   the fictional sample as a file, also the template
├── sample-data-2-small-shop.csv      a second fictional shop, six months long
├── sample-data-3-with-problems.csv   a small file with deliberate mistakes
├── tests.js                          checks the calculations and the sample files
└── README.md
```

## Run it locally

Open `index.html` in a browser. No server is needed.

## Run the tests

```bash
node tests.js
```

The tests check every number against a small set of repair orders worked out by hand, and check how messy files are handled: semicolons, bad dates, missing columns, extra columns and empty files. They also load the three sample files and check that each one behaves as described in this README.

## Publish with GitHub Pages

1. Push these files to a new public repository on your GitHub account.
2. Open **Settings, then Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick `main` and `/ (root)`, then save.
4. After a minute or two your site is live at `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`. Paste that link at the top of this README.

## Roadmap

**Version 2: the detailed columns** (see the section above)

- **On-time rate:** add the Promised column
- **First-time fix rate:** add the Comeback column, or find repeat visits automatically by matching VINs
- **Technician efficiency:** add the Billed hours and Clocked hours columns
- **Customer rating:** add the optional Rating column

**Later**

- Turnaround counted in shop hours only
- Set your own targets and compare two periods
- A matching Excel version
- French language toggle
