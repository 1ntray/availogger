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

    df.index.name = "Instructor"

    return df


def availability_style(value):
    if value == "available":
        return (
            "background-color: #c9efc3;"
            "color: transparent;"
        )

    if value == "unavailable":
        return (
            "background-color: #f1cccc;"
            "color: transparent;"
        )

    return (
        "background-color: #e6e6e6;"
        "color: transparent;"
    )



def style_availability_table(df):
    return (
        df.style
        .map(availability_style)
        .format(lambda value: "")
    )



