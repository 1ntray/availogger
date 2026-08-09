import json
from typing import Any

import requests
import streamlit as st

from queries import QUERY_PRESETS


API_URL = "https://api.flightlogger.net/graphql"
DEFAULT_PRESET = "Find user ID"


def run_query(
    query: str,
    variables: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Send a GraphQL query to FlightLogger."""

    try:
        token = st.secrets["FLIGHTLOGGER_API_TOKEN"]
    except KeyError as error:
        raise RuntimeError(
            "FLIGHTLOGGER_API_TOKEN is missing from "
            ".streamlit/secrets.toml."
        ) from error

    response = requests.post(
        API_URL,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "query": query,
            "variables": variables or {},
        },
        timeout=30,
    )

    response.raise_for_status()

    try:
        return response.json()
    except requests.exceptions.JSONDecodeError as error:
        raise RuntimeError(
            "FlightLogger returned a response that was not valid JSON."
        ) from error


def load_preset(preset_name: str) -> None:
    """Load a saved query into the two editor fields."""

    preset = QUERY_PRESETS[preset_name]

    st.session_state.query_editor = preset["query"]
    st.session_state.variables_editor = json.dumps(
        preset["variables"],
        indent=2,
    )

    # Remove the previous result when changing query.
    st.session_state.last_result = None


def initialise_state() -> None:
    """Create the required session-state values."""

    if "query_editor" not in st.session_state:
        default = QUERY_PRESETS[DEFAULT_PRESET]

        st.session_state.query_editor = default["query"]
        st.session_state.variables_editor = json.dumps(
            default["variables"],
            indent=2,
        )

    if "last_result" not in st.session_state:
        st.session_state.last_result = None


st.set_page_config(
    page_title="FlightLogger API",
    layout="wide",
)

initialise_state()

st.title("FlightLogger API Interface")

st.subheader("Saved queries")

# Put a maximum of three preset buttons on each row.
preset_names = list(QUERY_PRESETS)
button_columns = st.columns(min(3, len(preset_names)))

for index, preset_name in enumerate(preset_names):
    column = button_columns[index % len(button_columns)]

    with column:
        st.button(
            preset_name,
            key=f"preset_{index}",
            on_click=load_preset,
            args=(preset_name,),
            use_container_width=True,
        )

st.divider()

query = st.text_area(
    "GraphQL query",
    key="query_editor",
    height=400,
)

variables_text = st.text_area(
    "Variables",
    key="variables_editor",
    height=220,
    help="Variables must use valid JSON syntax.",
)

if st.button(
    "Run query",
    type="primary",
    use_container_width=True,
):
    try:
        variables = json.loads(variables_text)

        if not isinstance(variables, dict):
            raise ValueError(
                "The variables field must contain a JSON object."
            )

        with st.spinner("Running query..."):
            result = run_query(query, variables)

        st.session_state.last_result = result

    except json.JSONDecodeError as error:
        st.error(
            "The variables field contains invalid JSON. "
            f"Check line {error.lineno}, column {error.colno}."
        )

    except ValueError as error:
        st.error(str(error))

    except requests.HTTPError as error:
        status_code = error.response.status_code
        st.error(f"FlightLogger returned HTTP {status_code}.")

        if error.response.text:
            st.code(error.response.text)

    except requests.RequestException as error:
        st.error(f"Could not connect to FlightLogger: {error}")

    except RuntimeError as error:
        st.error(str(error))

if st.session_state.last_result is not None:
    st.subheader("Response")

    result = st.session_state.last_result

    if result.get("errors"):
        st.error("The query returned one or more GraphQL errors.")
        st.json(result["errors"])

        if result.get("data") is not None:
            st.subheader("Partial data")
            st.json(result["data"])
    else:
        st.success("Query completed.")
        st.json(result.get("data"))
