QUERY_PRESETS = {
    "Find user ID": {
        "query": """
query FindUser($searchTerm: String $first: Int) {
    users(searchTerm: $searchTerm first: $first) {
    nodes {
      id
      firstName
      lastName
      callSign
      contact {
        email
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }

  }
}
""".strip(),
        "variables": {
            "searchTerm": "Example",
            "first": 10,
        },
    },

    "User availability": {
        "query": """
query UserAvailability(
  $id: String
  $from: DateTime
  $to: DateTime
  $first: Int
) {
  user(id: $id) {
    id
    firstName
    lastName

    availabilities(
      from: $from
      to: $to
      first: $first
    ) {
      nodes {
        startsAt
        endsAt
        unavailable
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
""".strip(),
        "variables": {
            "id": "PASTE_USER_ID_HERE",
            "from": "2026-08-07T00:00:00+02:00",
            "to": "2026-08-14T23:59:59+02:00",
            "first": 100,
        },
    },
}
