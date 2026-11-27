using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stayra.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class HomeBackgrounds : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BgAboutUrl",
                table: "Tenants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BgContactUrl",
                table: "Tenants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BgPoliciesUrl",
                table: "Tenants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BgRoomsUrl",
                table: "Tenants",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BgAboutUrl",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "BgContactUrl",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "BgPoliciesUrl",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "BgRoomsUrl",
                table: "Tenants");
        }
    }
}
