from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from api.engine import votes

router = APIRouter(prefix="/votes", tags=["votes"])


class Vote(BaseModel):
    room: str = Field(min_length=1)
    player_id: str = Field(min_length=1)
    option_id: int


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def create_vote(vote: Vote) -> None:
    try:
        await votes.register_vote(vote.room, vote.player_id, vote.option_id)
    except votes.RoomNotFound as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(error))
    except votes.VoteRejected as error:
        raise HTTPException(status.HTTP_409_CONFLICT, str(error))
