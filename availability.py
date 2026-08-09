from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pandas as pd

from queries import USERS_BY_ROLE_QUERY, USER_AVAILABILITY_QUERY


TIMEZONE = ZoneInfo("Europe/Oslo")


def get_users_by_role(run_query, role):
    """Get all visible users with a particular role."""

    users = []
    after = None

    while True:
        variables = {
            "roles": [role],
            "first": 50,
            "after": after,
        }

        result = run_query(
            USERS_BY_ROLE_QUERY,
            variables,
        )

        connection = result["data"]["users"]

        users.extend(connection["nodes"])

        if not connection["pageInfo"]["hasNextPage"]:
            break

        after = connection["pageInfo"]["endCursor"]

    return users


def get_user_availability(
    run_query,
    user_id,
    start,
    end,
):
    """Get all availability records for one user."""

    records = []
    after = None

    while True:
        variables = {
            "id": user_id,
            "from": start.isoformat(),
            "to": end.isoformat(),
            "first": 50,
            "after": after,
        }

        result = run_query(
            USER_AVAILABILITY_QUERY,
            variables,
        )

        connection = (
            result["data"]["user"]["availabilities"]
        )

        records.extend(connection["nodes"])

        if not connection["pageInfo"]["hasNextPage"]:
            break

        after = connection["pageInfo"]["endCursor"]

    return records


def parse_datetime(value):
    return datetime.fromisoformat(
        value.replace("Z", "+00:00")
    ).astimezone(TIMEZONE)


def record_overlaps_day(record, day):
    record_start = parse_datetime(record["startsAt"])
    record_end = parse_datetime(record["endsAt"])

    day_start = datetime(
        day.year,
        day.month,
        day.day,
        tzinfo=TIMEZONE,
    )

    day_end = day_start + timedelta(days=1)

    return (
        record_start < day_end
        and record_end > day_start
    )


def status_for_day(records, day):
    overlapping = [
        record
        for record in records
        if record_overlaps_day(record, day)
    ]

    if not overlapping:
        return "undefined"

    if any(
        record["unavailable"]
        for record in overlapping
    ):
        return "unavailable"

    return "available"



def build_availability_table(
    run_query,
    days=30,
):
    today = datetime.now(TIMEZONE).date()

    dates = [
        today + timedelta(days=i)
        for i in range(days)
    ]

    start = datetime(
        today.year,
        today.month,
        today.day,
        tzinfo=TIMEZONE,
    )

    end = start + timedelta(days=days)

    users = get_users_by_role(
        run_query,
        "FLIGHT_INSTRUCTOR",
    )

    rows = {}

    for user in users:
        records = get_user_availability(
            run_query,
            user["id"],
            start,
            end,
        )

        name = user["callSign"]

        if not name:
            name = (
                f'{user["firstName"]} '
                f'{user["lastName"]}'
            )

        rows[name] = [
            status_for_day(
                records,
                day,
            )
            for day in dates
        ]

    columns = [
        (
            f"W{day.isocalendar().week}",
            f"{day.day:02d}",
        )
        for day in dates
    ]

    df = pd.DataFrame(
        rows,
        index=pd.MultiIndex.from_tuples(
            columns,
            names=["Week", "Day"],
        ),
    ).T


    return df




def availability_style(value):
    if value == "available":
        return "background-color: #8fe388; color: transparent;"

    if value == "unavailable":
        return "background-color: #e98b8b; color: transparent;"

    return "background-color: #b8b8b8; color: transparent;"




def availability_styles(df):
    styles = pd.DataFrame(
        "",
        index=df.index,
        columns=df.columns,
    )

    for row in range(len(df)):
        # Alternate the undefined grey for each instructor
        if row % 2 == 0:
            undefined_colour = "#b8b8b8"
        else:
            undefined_colour = "#c4c4c4"

        for col in range(len(df.columns)):
            value = df.iat[row, col]

            if value == "available":
                colour = "#a8df8e"

            elif value == "unavailable":
                colour = "#d58f8f"

            else:
                colour = undefined_colour

            styles.iat[row, col] = (
                f"background-color: {colour}; "
                "color: transparent;"
            )

    return styles



def style_availability_table(df):
    table_styles = [
        {
            "selector": "th",
            "props": [
                ("border", "1px solid #777777"),
                ("background-color", "#e8e8e8"),
                ("color", "#222222"),
                ("font-weight", "600"),
                ("padding", "2px"),
                ("height", "26px"),
                ("text-align", "center"),
                ("font-size", "11px"),
            ],
        },
        {
            "selector": "td",
            "props": [
                ("border", "1px solid #777777"),
                ("padding", "0"),
                ("height", "26px"),
            ],
        },
        {
            "selector": "th.row_heading",
            "props": [
                ("text-align", "left"),
                ("padding-left", "5px"),
                ("white-space", "nowrap"),
                ("width", "85px"),
                ("min-width", "85px"),
                ("max-width", "85px"),
                ("overflow", "hidden"),
            ],
        },
        {
            "selector": "thead th:first-child",
            "props": [
                ("width", "85px"),
                ("min-width", "85px"),
                ("max-width", "85px"),
            ],
        },
        {
    "selector": "tbody tr:nth-child(odd) th.row_heading",
    "props": [
        ("background-color", "#e8e8e8"),
    ],
},
{
    "selector": "tbody tr:nth-child(even) th.row_heading",
    "props": [
        ("background-color", "#f2f2f2"),
    ],
},
    ]

    # Add a thick line at the beginning of every new week
    for i in range(1, len(df.columns)):
        current_week = df.columns[i][0]
        previous_week = df.columns[i - 1][0]

        if current_week != previous_week:
            table_styles.append({
                "selector": f"th.col{i}, td.col{i}",
                "props": [
                    ("border-left", "3px solid #222222 !important"),
                ],
            })

    return (
        df.style
        .apply(availability_styles, axis=None)
        .format(lambda value: "")
        .set_table_attributes(
            'style="'
            'width: 100%; '
            'table-layout: fixed; '
            'border-collapse: collapse; '
            'border-spacing: 0;'
            '"'
        )
        .set_table_styles(table_styles)
    )
