package app.tuno

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/** One path of an icon: filled, stroked with [stroke] width, or both. */
private class P(val d: String, val stroke: Float = 0f, val fill: Boolean = stroke == 0f)

/** Icons as path data (Spotify-style line icons; keeps the app small instead of shipping an icon library). */
private fun vec(name: String, vararg paths: P, viewport: Float = 24f): ImageVector {
    val b = ImageVector.Builder(name, 24.dp, 24.dp, viewport, viewport)
    for (p in paths) {
        b.addPath(
            pathData = PathParser().parsePathString(p.d).toNodes(),
            fill = if (p.fill) SolidColor(Color.Black) else null,
            stroke = if (p.stroke > 0f) SolidColor(Color.Black) else null,
            strokeLineWidth = p.stroke,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        )
    }
    return b.build()
}

private const val HOUSE = "M4 9.6L12 4.4l8 5.2V20h-5.2v-6.2H9.2V20H4z"
private const val CIRCLE = "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z"

object TIcons {
    val Home = vec("Home", P(HOUSE, 1.8f))
    val HomeFilled = vec("HomeFilled", P(HOUSE, 1.8f, fill = true))
    val Search = vec("Search", P("M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13z", 1.8f), P("M15.4 15.4L20.5 20.5", 1.8f))
    val SearchBold = vec("SearchBold", P("M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13z", 2.7f), P("M15.4 15.4L20.5 20.5", 2.7f))
    val Library = vec("Library", P("M5 4v16M10 4v16M14.4 4.9l4.8 14.4", 1.8f))
    val LibraryFilled = vec("LibraryFilled", P("M5 4v16M10 4v16M14.4 4.9l4.8 14.4", 2.9f))
    val Plus = vec("Plus", P("M12 4.5v15M4.5 12h15", 1.8f))
    val PlusBold = vec("PlusBold", P("M12 4.5v15M4.5 12h15", 2.6f))
    val ChevronDown = vec("ChevronDown", P("M5 8.5l7 7 7-7", 2f))
    val Back = vec("Back", P("M15.5 4.5L8 12l7.5 7.5", 2.1f))
    val ChevronRight = vec("ChevronRight", P("M9 5l7 7-7 7", 1.8f))
    val MoreVert = vec(
        "MoreVert",
        P("M12 3.6a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 1 0 0-3.4zM12 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 1 0 0-3.4zM12 17a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 1 0 0-3.4z"),
    )
    val MoreHoriz = vec(
        "MoreHoriz",
        P("M5.3 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 1 0 0-3.4zM12 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 1 0 0-3.4zM18.7 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 1 0 0-3.4z"),
    )
    val Play = vec("Play", P("M7.5 4.9v14.2a1 1 0 0 0 1.5.86l11.4-7.1a1 1 0 0 0 0-1.72L9 4.04a1 1 0 0 0-1.5.86z"))
    val Pause = vec(
        "Pause",
        P("M6.6 4h2.8a.6.6 0 0 1 .6.6v14.8a.6.6 0 0 1-.6.6H6.6a.6.6 0 0 1-.6-.6V4.6a.6.6 0 0 1 .6-.6zm8 0h2.8a.6.6 0 0 1 .6.6v14.8a.6.6 0 0 1-.6.6h-2.8a.6.6 0 0 1-.6-.6V4.6a.6.6 0 0 1 .6-.6z"),
    )
    val SkipNext = vec(
        "SkipNext",
        P("M4.5 5.1v13.8a.8.8 0 0 0 1.24.66L16 12.66v6.54c0 .44.36.8.8.8h1.9c.44 0 .8-.36.8-.8V4.8a.8.8 0 0 0-.8-.8h-1.9a.8.8 0 0 0-.8.8v6.54L5.74 4.44A.8.8 0 0 0 4.5 5.1z"),
    )
    val SkipPrevious = vec(
        "SkipPrevious",
        P("M19.5 5.1v13.8a.8.8 0 0 1-1.24.66L8 12.66v6.54a.8.8 0 0 1-.8.8H5.3a.8.8 0 0 1-.8-.8V4.8c0-.44.36-.8.8-.8h1.9c.44 0 .8.36.8.8v6.54l10.26-6.9a.8.8 0 0 1 1.24.66z"),
    )
    val Shuffle = vec(
        "Shuffle",
        P("M3 7h3.2c2 0 3.2.9 4.2 2.6l2.9 5c1 1.6 2.2 2.4 4.2 2.4H20.5M3 17h3.2c1.4 0 2.4-.4 3.2-1.2M14.4 8.2C15.2 7.4 16.2 7 17.5 7H20.5M18.2 4.5L20.7 7l-2.5 2.5M18.2 14.5l2.5 2.5-2.5 2.5", 1.7f),
    )
    val Repeat = vec(
        "Repeat",
        P("M4 12.5V9.8A3.8 3.8 0 0 1 7.8 6H19.5M17 3.5L19.5 6 17 8.5M20 11.5v2.7a3.8 3.8 0 0 1-3.8 3.8H4.5M7 20.5L4.5 18 7 15.5", 1.7f),
    )
    val PlusCircle = vec("PlusCircle", P(CIRCLE, 1.6f), P("M12 8v8M8 12h8", 1.6f))
    val DownloadCircle = vec("DownloadCircle", P(CIRCLE, 1.6f), P("M12 7.5v8.2M8.6 12.6L12 16l3.4-3.4", 1.6f))
    val Download = vec("Download", P("M12 4v11M7 10.5l5 5 5-5M5 20h14", 1.8f))
    val Share = vec("Share", P("M12 3.5v11.5M7.8 7.7L12 3.5l4.2 4.2M6 11H5v9.5h14V11h-1", 1.7f))
    val Queue = vec("Queue", P("M3.5 5.5h17M3.5 12h10M3.5 18.5h10", 1.7f), P("M17 12.4v7.2l5-3.6z"))
    val Pin = vec("Pin", P("M15.2 2.8l6 6-2.6 1.1-3.7 3.7.5 4.6-1.7 1.7-3.5-3.5-5.2 5.2-1.1-1.1 5.2-5.2-3.5-3.5 1.7-1.7 4.6.5 3.7-3.7z"))
    val Sort = vec("Sort", P("M7.5 4v16M4.5 17l3 3 3-3M16.5 20V4M13.5 7l3-3 3 3", 1.6f))
    val Grid = vec("Grid", P("M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z", 1.6f))
    val ListView = vec("ListView", P("M4 6h16M4 12h16M4 18h16", 1.7f))
    val Close = vec("Close", P("M6 6l12 12M18 6L6 18", 2f))
    val Link = vec(
        "Link",
        P("M10.2 13.8a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.1 1.1M13.8 10.2a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.1-1.1", 1.8f),
    )
    val Clock = vec("Clock", P(CIRCLE, 1.6f), P("M12 7v5.2l3.4 2", 1.6f))
    val Trash = vec("Trash", P("M4 6.5h16M9.5 6.5V4h5v2.5M6.5 6.5l1 13.5h9l1-13.5M10 10.5v6M14 10.5v6", 1.6f))
    val Edit = vec("Edit", P("M4 20h4.2L19.4 8.8 15.2 4.6 4 15.8zM13 6.8l4.2 4.2", 1.6f))
    val Person = vec("Person", P("M12 3.5a4 4 0 1 0 0 8 4 4 0 1 0 0-8zM4.5 20.5c.8-3.6 3.9-6 7.5-6s6.7 2.4 7.5 6", 1.6f))
    val Album = vec("Album", P(CIRCLE, 1.6f), P("M12 9.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 1 0 0-4.4z", 1.6f))
    val Settings = vec(
        "Settings",
        P(
            "M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 1 0 0-6.4zM19.4 13.4l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2 1.2L14.8 20.5h-4l-.3-2a7 7 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-2.4L4.6 9.8l2-3.4 1.9.7a7 7 0 0 1 2-1.2l.3-2.4h4l.3 2.4a7 7 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 2.4z",
            1.6f,
        ),
    )
    val Refresh = vec("Refresh", P("M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.2h-4.2", 1.8f))
    val Logout = vec("Logout", P("M14 4.5H6.5v15H14M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5", 1.7f))
    val Note = vec("Note", P("M9 18.5V5.5l10-2v12.5", 1.6f), P("M6.5 16a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5zM16.5 13.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5z", 1.6f))
    val Heart = vec(
        "Heart",
        P("M12 20.6l-1.45-1.32C5.4 14.6 2 11.5 2 7.7 2 4.6 4.4 2.2 7.5 2.2c1.74 0 3.41.81 4.5 2.09C13.09 3.01 14.76 2.2 16.5 2.2 19.6 2.2 22 4.6 22 7.7c0 3.8-3.4 6.9-8.55 11.59z"),
    )
    val Paste = vec("Paste", P("M9 4.5h6v2.5H9zM9 5.5H6v15h12v-15h-3", 1.6f))
    val Info = vec("Info", P(CIRCLE, 1.6f), P("M12 11v5.5M12 7.6v.2", 1.9f))

    /** The Tuno logo glyph (same shape as the launcher icon). */
    val Logo = vec("Logo", P("M17.5,13h29a4.5,4.5 0,0 1,0 9H42v22.5a10,10 0,1 1,-8 -9.8V22H17.5a4.5,4.5 0,0 1,0 -9z"), viewport = 64f)
}
