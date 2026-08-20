# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
import logging
from datetime import datetime
from uuid import UUID, uuid4

from flask import request, Response
from flask_appbuilder.api import expose, protect, safe
from marshmallow import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from superset import db
from superset.constants import MODEL_API_RW_METHOD_PERMISSION_MAP
from superset.daos.dashboard import DashboardDAO
from superset.daos.key_value import KeyValueDAO
from superset.dashboards.bookmarks.schemas import (
    DashboardBookmarkPostSchema,
    DashboardBookmarkSchema,
)
from superset.extensions import event_logger
from superset.key_value.models import KeyValueEntry
from superset.key_value.types import KeyValueResource, MarshmallowKeyValueCodec
from superset.utils.core import get_user_id
from superset.views.base_api import BaseSupersetApi, requires_json

logger = logging.getLogger(__name__)


class DashboardBookmarkRestApi(BaseSupersetApi):
    allow_browser_login = True
    method_permission_name = MODEL_API_RW_METHOD_PERMISSION_MAP
    class_permission_name = "DashboardPermalinkRestApi"
    resource_name = "dashboard/bookmark"
    openapi_spec_tag = "Dashboard Bookmark"

    resource = KeyValueResource.DASHBOARD_BOOKMARK
    post_schema = DashboardBookmarkPostSchema()
    bookmark_schema = DashboardBookmarkSchema()
    codec = MarshmallowKeyValueCodec(DashboardBookmarkSchema())

    def _resolve_dashboard_uuid(self, dashboard_id: str) -> str:
        dashboard = DashboardDAO.get_by_id_or_slug(dashboard_id)
        if dashboard is None:
            raise ValueError("Dashboard not found")
        dashboard.raise_for_access()
        return str(dashboard.uuid)

    @expose("/", methods=("GET",))
    @protect()
    @safe
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.get",
        log_to_statsd=False,
    )
    def get(self) -> Response:
        dashboard_id = request.args.get("dashboard_id")
        dashboard_uuid = None

        try:
            if dashboard_id:
                dashboard_uuid = self._resolve_dashboard_uuid(dashboard_id)

            entries = (
                db.session.query(KeyValueEntry)
                .filter(
                    KeyValueEntry.resource == self.resource.value,
                    KeyValueEntry.created_by_fk == get_user_id(),
                )
                .order_by(KeyValueEntry.created_on.desc())
                .all()
            )

            now = datetime.now()
            result = []
            for entry in entries:
                if entry.expires_on and entry.expires_on <= now:
                    continue

                try:
                    bookmark = self.codec.decode(entry.value)
                except Exception:
                    logger.exception("Error decoding dashboard bookmark")
                    continue

                if dashboard_uuid and bookmark["dashboard_id"] != dashboard_uuid:
                    continue

                result.append(bookmark)

            result.sort(key=lambda item: (item["dashboard_title"], item["name"]))
            return self.response(200, count=len(result), result=result)
        except ValueError as ex:
            return self.response(404, message=str(ex))
        except SQLAlchemyError:
            logger.exception("Error getting dashboard bookmarks")
            return self.response(500, message="Error getting dashboard bookmarks")

    @expose("/", methods=("POST",))
    @protect()
    @safe
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.post",
        log_to_statsd=False,
    )
    @requires_json
    def post(self) -> Response:
        try:
            payload = self.post_schema.load(request.json)
            dashboard_id = str(payload["dashboard_id"])
            dashboard = DashboardDAO.get_by_id_or_slug(dashboard_id)
            if dashboard is None:
                return self.response(404, message="Dashboard not found")
            dashboard.raise_for_access()

            bookmark = {
                "id": str(uuid4()),
                "name": payload["name"],
                "permalink": payload["permalink"],
                "dashboard_id": str(dashboard.uuid),
                "dashboard_title": dashboard.dashboard_title,
            }

            KeyValueDAO.create_entry(
                resource=self.resource,
                value=bookmark,
                codec=self.codec,
                key=UUID(bookmark["id"]),
            )
            db.session.commit()
            return self.response(201, result=bookmark)
        except ValidationError as ex:
            return self.response(400, message=ex.messages)
        except SQLAlchemyError:
            db.session.rollback()
            logger.exception("Error creating dashboard bookmark")
            return self.response(500, message="Error creating dashboard bookmark")

    @expose("/<string:key>", methods=("DELETE",))
    @protect()
    @safe
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.delete",
        log_to_statsd=False,
    )
    def delete(self, key: str) -> Response:
        try:
            uuid_key = UUID(key)
            entry = KeyValueDAO.get_entry(self.resource, uuid_key)
            if entry is None:
                return self.response_404()

            if entry.created_by_fk != get_user_id():
                return self.response(403, message="Access denied")

            db.session.delete(entry)
            db.session.commit()
            return self.response(200, message="Deleted")
        except ValueError:
            return self.response(400, message="Invalid bookmark key")
        except SQLAlchemyError:
            db.session.rollback()
            logger.exception("Error deleting dashboard bookmark")
            return self.response(500, message="Error deleting dashboard bookmark")
