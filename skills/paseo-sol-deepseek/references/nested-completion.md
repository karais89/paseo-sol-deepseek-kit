# Nested completion only

Read only when the coordinator was explicitly launched under an outer controller and the launch assignment supplies that recipient's agent/server IDs. A normal independent conversation does not need this step.

In Paseo 0.13 an interim idle acknowledgement can reach the controller as a finish notification. After actual final acceptance, send one explicit completion report with `send_agent_prompt` and `notifyOnFinish:false` to the supplied recipient. Verify the destination with `list_hosts` if it has not already been confirmed. Reuse confirmed identifiers; never guess them or report completion at initial delegation. Do not replace completion notifications with polling. This workaround was observed in one version, not established as a general runtime guarantee.
