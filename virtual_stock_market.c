#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <time.h>
#include <conio.h>
#ifdef _WIN32
#include <windows.h>
#else
#include <unistd.h>
#include <termios.h>    
#include <fcntl.h>  
#include <sys/select.h>
#endif
#define MAX_TICKS 60
#define MAX_PRICE 6000

typedef struct {
    char username[50];
    char fullname[50];
    char password[50];
    int balance;
} user;


typedef struct
{
    char symbol[50];
    char name[50];
    int price;
} stocks;

typedef struct {
    char username[100];
    int balance;
    char stocks[100];
} portfolio;

int login_check(char input_username[], char input_password[], user* logged_in_user);
void sign_up();
void show_portfolio(char username[]);
void buy_stocks(char username[], user* current_user,stocks* stock);
void buy_stocks(char username[], user* current_user,stocks* stock);
void update_portfolio(char username[],user* current_user,int quantity,int stock_price,stocks* stock,int stock_select);
void update_balance(char username[], user* current_user);
void sell_stocks(char username[], user* current_user, stocks* stock);
void fix_empty_portfolios(void);
void show_stock_trend(const char *stock_name); 

void set_nonblocking(int state);
void set_nonblocking(int state) {
#ifndef _WIN32
    struct termios ttystate;
    tcgetattr(STDIN_FILENO, &ttystate);

    if (state == 1) {
        ttystate.c_lflag &= ~ICANON;
        ttystate.c_lflag &= ~ECHO;
        ttystate.c_cc[VMIN] = 1;
    } else {
        ttystate.c_lflag |= ICANON;
        ttystate.c_lflag |= ECHO;
    }
    tcsetattr(STDIN_FILENO, TCSANOW, &ttystate);
#endif
}

int kbhit() {
#ifdef _WIN32
    return _kbhit();
#else
    struct timeval tv = { 0L, 0L };
    fd_set fds;
    FD_ZERO(&fds);
    FD_SET(0, &fds);
    return select(1, &fds, NULL, NULL, &tv);
#endif
}

void display_real_time_stock_graph_single(stocks* stock, int index) {
    if (index < 0) {
        printf("Invalid stock index.\n");
        return;
    }

    char symbol[50];
    strcpy(symbol, stock[index].symbol);

    int base_price = stock[index].price;
    int price = base_price;

    const int MAX_POINTS = 60;
    const int GRAPH_HEIGHT = 10;

    int price_history[MAX_POINTS];
    int filled_points = 0;
    int history_index = 0;

    srand(time(NULL) ^ clock());
    for (int i = 0; i < MAX_POINTS; i++) {
        price_history[i] = base_price + (rand() % 201 - 100);
    }

    set_nonblocking(1);

    while (1) {
#ifdef _WIN32
        system("cls");
#else
        system("clear");
#endif

        printf("\nReal-Time Stock Price for %s\n", symbol);
        printf("----------------------------------------------\n");

        int change = (rand() % 1001) - 500;
        price += change;
        if (price < 1000) price = 1001;

        price_history[history_index] = price;
        history_index = (history_index + 1) % MAX_POINTS;
        if (filled_points < MAX_POINTS) filled_points++;

        // Calculate min and max prices
        int min_price = price_history[0], max_price = price_history[0];
        for (int i = 1; i < filled_points; i++) {
            int idx = (history_index + i) % MAX_POINTS;
            if (price_history[idx] < min_price) min_price = price_history[idx];
            if (price_history[idx] > max_price) max_price = price_history[idx];
        }

        int range = max_price - min_price;
        if (range == 0) range = 1;

        // Draw Y axis from top to bottom
        for (int y = GRAPH_HEIGHT; y >= 0; y--) {
            int label_price = min_price + (range * y) / GRAPH_HEIGHT;
            printf("%5d |", label_price);  // Y-axis label and line

            for (int i = 0; i < filled_points; i++) {
                int idx = (history_index + i) % MAX_POINTS;
                int scaled = ((price_history[idx] - min_price) * GRAPH_HEIGHT) / range;

                if (scaled == y) {
    printf("*");
} else if (y == 0) {
    printf("_");  // x-axis
} else if (y < scaled) {
    printf("|");  // stem goes downward from star
} else {
    printf(" ");
}
            }
            printf("\n");
        }

        
        printf("      +");
       
        printf("\n");
        printf("\t\tTIME \n");
        printf("Current Price: %d\n", price);
        printf("Press 'q' to quit and return to menu...\n");

#ifdef _WIN32
        Sleep(1500);
#else
        usleep(1500000);
#endif

        if (kbhit()) {
            char c = getchar();
            if (c == 'q' || c == 'Q') break;
        }
    }

    set_nonblocking(0);
}


int main() {
    int choice;
    user current_user;
    int logged_in = 0;
    char username[50], password[50];
    srand(time(NULL)); // Seed random number generator ONCE at program start

    while (1) {
        printf("1.login\n");
        printf("2. Sign Up\n");
        printf("3. Exit\n");
        printf("Enter your choice: ");
        scanf("%d", &choice);
        getchar();

        if (choice == 1) {
            int apl=(rand()%600)+1200;
            int gogl=(rand()%600)+1800;
            int tsla=(rand()%600)+3000;
            int msft=(rand()%600)+4150;
            int amzn=(rand()%600)+1000;
            stocks stock[]={{"APL","Apple Inc.",apl},{"GOGL","Google",gogl},{"TSLA","Tesla",tsla},{"MSFT","Microsoft",msft},{"AMZN","Amazon",amzn}};

            printf("Enter username: ");
            scanf("%49s", username);
            while(getchar() != '\n'); // Clear input buffer

            printf("Enter password: ");
            char ch;
            int i=0;
            while(i < 49 && (ch=getch())!=13 && ch!=10){
                if (ch == 8 && i > 0) { // handle backspace
                    i--;
                    printf("\b \b");
                    continue;
                }
                password[i]=ch;
                i++;
                printf("*");
            }
            password[i]='\0';
            printf("\n");

            if (login_check(username, password, &current_user)) {
                printf("Login successful! Welcome, %s\n", current_user.fullname);
                logged_in = 1;
                int user_choice;
                while (logged_in) {
                    printf("\n--- USER MENU ---\n");
                    printf("1. Show Portfolio\n");
                    printf("2. Buy Stocks\n");
                    printf("3. Sell Stocks\n");
                    printf("4. Deposit Balance\n");
                    printf("5. View Real-Time Stock Graph\n");
                    printf("6. show stock trend\n");
                    printf("7. Logout\n");
                    printf("Enter your choice: ");
                    scanf("%d", &user_choice);
                    getchar();
                    switch (user_choice) {
                        case 1:
                            show_portfolio(username);
                            break;
                        case 2:
                            buy_stocks(username, &current_user, stock);
                            break;
                        case 3:
                            sell_stocks(username, &current_user, stock);
                            break;
                        case 4:
                            update_balance(username, &current_user);
                            break;
                        case 5: {
                            printf("\nSelect stock to view graph:\n");
                            for (int i = 0; i < 5; i++) {
                                printf("%d. %s (%s)\n", i+1, stock[i].name, stock[i].symbol);
                            }
                            int graph_choice;
                            printf("Enter choice: ");
                            scanf("%d", &graph_choice);
                            getchar();
                            if (graph_choice >= 1 && graph_choice <= 5) {
                                display_real_time_stock_graph_single(stock, graph_choice-1);
                            } else {
                                printf("Invalid choice.\n");
                            }
                            break;
                        }
                        case 6:
                            printf("Select stock to view trend:\n");
                            for (int i = 0; i < 5; i++) {
                                printf("%d. %s (%s)\n", i+1, stock[i].name, stock[i].symbol);
                            }
                            int trend_choice;
                            printf("Enter choice: ");
                            scanf("%d", &trend_choice);
                            getchar();
                            if (trend_choice >= 1 && trend_choice <= 5) {
                                show_stock_trend(stock[trend_choice-1].symbol);
                            } else {
                                printf("Invalid choice.\n");
                            }
                            break;
                        case 7:
                            logged_in = 0;
                            printf("Logged out.\n");
                            break;
                        default:
                            printf("Invalid choice.\n");
                    }
                }
            } else {
                printf("Login failed. Invalid username or password.\n");
            }
        } else if (choice == 2) {
            sign_up();
        } else if (choice == 3) {
            printf("Exiting...\n");
            break;
        } else {
            printf("Invalid choice. Try again.\n");
        }
    }
    return 0;
}

void sign_up() {
    user new_user, temp;
    int exists;
    FILE* fp;

    do {
        exists = 0;
        printf("Enter username: ");
        scanf("%49s", new_user.username);
        while(getchar() != '\n'); // Clear input buffer

        fp = fopen("users.txt", "r");
        if (fp != NULL) {
            while (fscanf(fp, "%49s %49s %49s %d", temp.username, temp.fullname, temp.password, &temp.balance) != EOF) {
                if (strcmp(temp.username, new_user.username) == 0) {
                    exists = 1;
                    printf("Username already exists. Try another one.\n");
                    break;
                }
            }
            fclose(fp);
        }
    } while (exists);

    printf("Enter full name: ");
    scanf(" %49[^\n]", new_user.fullname);
    printf("Enter password (max 49 characters): ");
    scanf("%49s", new_user.password);
    while(getchar() != '\n'); // Clear input buffer
    new_user.balance = 10000;

    fp = fopen("users.txt", "a");
    if (fp == NULL) {
        printf("Error opening users file for writing.\n");
        return;
    }
    fprintf(fp, "%s %s %s %d\n", new_user.username, new_user.fullname, new_user.password, new_user.balance);
    fclose(fp);

    FILE* port = fopen("portfolio.txt", "a");
    if (port == NULL) {
        printf("Error opening portfolio file for writing.\n");
        return;
    }
    portfolio p = {"", 10000, "None"};
    strcpy(p.username, new_user.username);
    fprintf(port, "%s %d %s\n", p.username, p.balance, p.stocks);
    fclose(port);

    printf("User registered successfully!\n");
}


int login_check(char input_username[], char input_password[], user* logged_in_user) {
    user temp;
    FILE* fp = fopen("users.txt", "r");
    if (fp == NULL) {
        printf("Error opening users file.\n");
        return 0;
    }

    while (fscanf(fp, "%49s %49s %49s %d", temp.username, temp.fullname, temp.password, &temp.balance) != EOF) {
        if (strcmp(temp.username, input_username) == 0 && strcmp(temp.password, input_password) == 0) {
            *logged_in_user = temp;
            fclose(fp);
            return 1;
        }
    }

    fclose(fp);
    return 0;
}



void show_portfolio(char username[]) {
    FILE* fp = fopen("portfolio.txt", "r");
    portfolio temp;
    int found=0;

    if (fp == NULL) {
        printf("Error opening portfolio file.\n");
        return;
    }

    while (fscanf(fp, "%s %d %s", temp.username, &temp.balance, temp.stocks) != EOF) {
        if (strcmp(temp.username, username) == 0) {
            printf("\n---- Portfolio ----\n\n");
            printf("Username : %s\n", temp.username);
            printf("Balance  : %d\n", temp.balance);
            printf("Stocks   : %s\n\n\n", temp.stocks);
            found=1;
            break;
        }
    }

    if (found==0) {
        printf("portfolio not found");
    }

    fclose(fp);
}

void buy_stocks(char username[], user* current_user,stocks* stock){
    
    //stocks stock[]={{"APL","Apple Inc.",apl},{"GOGL","Google",gogl},{"TSLA","Tesla",tsla},{"MSFT","Microsoft",msft},{"AMZN","Amazon",amzn}};
    printf("\n%-5s %-15s %-15s  %-10s\n","S.No","Symbol","Company","Price");
    printf("---------------------------------------------\n");
    for(int i=0;i<5;i++){
        printf("%-5d %-15s %-15s %-10d\n",i+1,stock[i].symbol,stock[i].name,stock[i].price);
    }
    printf("\nselect your stock (enter serial number): ");
    int stock_select;
    scanf("%d",&stock_select);
    getchar();
    int quantity;
    printf("enter quantity : ");
    scanf("%d",&quantity);
    getchar();
    if(stock_select==1){
        int stock_price;
        stock_price=quantity*stock[0].price;
        printf("\nstock: %s\n",stock[0].symbol);
        printf("quantity: %d\n",quantity);
        printf("total price of the order : %d\n",stock_price);
        update_portfolio(username,current_user,quantity,stock_price,stock,stock_select);
    }
    if(stock_select==2){
        int stock_price;
        stock_price=quantity*stock[1].price;
        printf("\nstock: %s\n",stock[1].symbol);
        printf("quantity: %d\n",quantity);
        printf("total price of the order : %d\n",stock_price);
        update_portfolio(username,current_user,quantity,stock_price,stock,stock_select);
    }
    if(stock_select==3){
        int stock_price;
        stock_price=quantity*stock[2].price;
        printf("\nstock: %s\n",stock[2].symbol);
        printf("quantity: %d\n",quantity);
        printf("total price of the order : %d\n",stock_price);
        update_portfolio(username,current_user,quantity,stock_price,stock,stock_select);
    }
    if(stock_select==4){
        int stock_price;
        stock_price=quantity*stock[3].price;
        printf("\nstock: %s\n",stock[3].symbol);
        printf("quantity: %d\n",quantity);
        printf("total price of the order : %d\n",stock_price);
        update_portfolio(username,current_user,quantity,stock_price,stock,stock_select);
    }
    if(stock_select==5){
        int stock_price;
        stock_price=quantity*stock[4].price;
        printf("\nstock: %s\n",stock[4].symbol);
        printf("quantity: %d\n",quantity);
        printf("total price of the order : %d\n",stock_price);
        update_portfolio(username,current_user,quantity,stock_price,stock,stock_select);
    }
}
void update_portfolio(char username[], user* current_user, int quantity, int stock_price, stocks* stock, int stock_select) {
    if (current_user->balance < stock_price) {
        printf("Insufficient balance.\n");
        return;
    }

    user temp_user;
    user users[100];
    int user_count = 0;
    int new_balance = 0;
    FILE* fp = fopen("users.txt", "r");
    if (fp == NULL) {
        printf("Error opening users file.\n");
        return;
    }
    while (fscanf(fp, "%s %s %s %d", temp_user.username, temp_user.fullname, temp_user.password, &temp_user.balance) != EOF) {
        if (strcmp(temp_user.username, username) == 0) {
            temp_user.balance -= stock_price;
            new_balance = temp_user.balance;
            *current_user = temp_user;
        }
        users[user_count++] = temp_user;
    }
    fclose(fp);

    fp = fopen("users.txt", "w");
    for (int i = 0; i < user_count; i++) {
        fprintf(fp, "%s %s %s %d\n", users[i].username, users[i].fullname, users[i].password, users[i].balance);
    }
    fclose(fp);

    FILE* pf = fopen("portfolio.txt", "r");
    portfolio portfolios[100];
    int port_count = 0;
    portfolio temp_port;
    if (pf == NULL) {
        printf("Error opening portfolio file.\n");
        return;
    }
    while (fscanf(pf, "%s %d %s", temp_port.username, &temp_port.balance, temp_port.stocks) != EOF) {
        portfolios[port_count++] = temp_port;
    }
    fclose(pf);

    for (int i = 0; i < port_count; i++) {
        if (strcmp(portfolios[i].username, username) == 0) {
            portfolios[i].balance = new_balance; 
            char updated_stocks[200] = "";
            int found = 0;
            char* token = strtok(portfolios[i].stocks, ",");
            while (token != NULL && strcmp(portfolios[i].stocks, "None") != 0) {
                char sym[50];
                int quant;
                sscanf(token, "%[^:]:%d", sym, &quant);
                if (strcmp(sym, stock[stock_select-1].symbol) == 0) {
                    quant += quantity;
                    found = 1;
                }
                char entry[50];
                sprintf(entry, "%s:%d,", sym, quant);
                strcat(updated_stocks, entry);
                token = strtok(NULL, ",");
            }
            if (!found) {
                char entry[50];
                sprintf(entry, "%s:%d,", stock[stock_select-1].symbol, quantity);
                strcat(updated_stocks, entry);
            }
            
            int len = strlen(updated_stocks);
            if (len > 0 && updated_stocks[len-1] == ',') updated_stocks[len-1] = '\0';
            strcpy(portfolios[i].stocks, updated_stocks);
        }
    }

    pf = fopen("portfolio.txt", "w");
    for (int i = 0; i < port_count; i++) {
        fprintf(pf, "%s %d %s\n", portfolios[i].username, portfolios[i].balance, portfolios[i].stocks);
    }
    fclose(pf);

    printf("order successful!!\n");
}
void update_balance(char username[], user* current_user) {
    printf("Enter the amount you want to deposit: ");
    int dep;
    scanf("%d", &dep);

    if (dep > 50000) {
        printf("Maximum deposit limit is 50000.\n");
        return;
    }
    user users[100];
    user temp_user;
    int user_count = 0;
    FILE* fp = fopen("users.txt", "r");
    if (!fp) {
        printf("Error opening file.\n");
        return;
    }

    while (fscanf(fp, "%s %s %s %d", temp_user.username, temp_user.fullname, temp_user.password, &temp_user.balance) != EOF) {
        if (strcmp(temp_user.username, username) == 0) {
            temp_user.balance += dep;    
            *current_user = temp_user;      
        }
        users[user_count++] = temp_user;
    }

    fclose(fp);
    fp = fopen("users.txt", "w");
    for (int i = 0; i < user_count; i++) {
        fprintf(fp, "%s %s %s %d\n", users[i].username, users[i].fullname, users[i].password, users[i].balance);
    }
    fclose(fp);

    portfolio temp_port;
    portfolio temp_port_struct[100];
    int port_count = 0;
    FILE* port = fopen("portfolio.txt", "r");
    if (!port) {
        printf("Error opening portfolio file.\n");
        return;
    }
    while (fscanf(port, "%s %d %s", temp_port.username, &temp_port.balance, temp_port.stocks) != EOF) {
        if (strcmp(temp_port.username, username) == 0) {
            temp_port.balance += dep;
        }
        temp_port_struct[port_count++] = temp_port;
    }
    fclose(port);
    port = fopen("portfolio.txt", "w");
    for (int i = 0; i < port_count; i++) {
        fprintf(port, "%s %d %s\n", temp_port_struct[i].username, temp_port_struct[i].balance, temp_port_struct[i].stocks);
    }
    fclose(port);
    //fclose(port);
}

void sell_stocks(char username[], user* current_user, stocks* stock) {
    FILE* pf = fopen("portfolio.txt", "r");
    portfolio temp_port;
    portfolio temp_port_struct[100];
    int port_count = 0;
    int found = 0;
    int quantity;
    user temp_user;
    user users[100];
    int user_count = 0;
    int sale_amount = 0;

    if (pf == NULL) {
        printf("Error opening portfolio file.\n");
        return;
    }
    while (fscanf(pf, "%s %d %s", temp_port.username, &temp_port.balance, temp_port.stocks) != EOF) {
        if (strcmp(temp_port.username, username) == 0) {
            found = 1;
            char stocks_copy[200];
            strcpy(stocks_copy, temp_port.stocks);
            char* token = strtok(stocks_copy, ",");
            printf("Available stocks:\n");
            while (token != NULL) {
                char sym[50];
                int quant;
                sscanf(token, "%[^:]:%d", sym, &quant);
                printf("%s: %d\n", sym, quant);
                token = strtok(NULL, ",");
            }
            printf("Enter the stock symbol you want to sell: ");
            char stock_symbol[50];
            scanf("%s", stock_symbol);
            printf("Enter the quantity you want to sell: ");
            scanf("%d", &quantity);
            char updated_stocks[200] = "";
            strcpy(stocks_copy, temp_port.stocks);
            token = strtok(stocks_copy, ",");
            int stock_found = 0;
            int stock_index = -1;
            for (int i = 0; i < 5; i++) {
                if (strcmp(stock[i].symbol, stock_symbol) == 0) {
                    stock_index = i;
                    break;
                }
            }
            if (stock_index == -1) {
                printf("Invalid stock symbol.\n");
                fclose(pf);
                return;
            }
            while (token != NULL) {
                char sym[50];
                int quant;
                sscanf(token, "%[^:]:%d", sym, &quant);
                if (strcmp(sym, stock_symbol) == 0) {
                    stock_found = 1;
                    if (quant < quantity) {
                        printf("Not enough stocks to sell.\n");
                        fclose(pf);
                        return;
                    }
                    quant -= quantity;
                    if (quant > 0) {
                        char entry[50];
                        sprintf(entry, "%s:%d,", sym, quant);
                        strcat(updated_stocks, entry);
                    }
                } else {
                    char entry[50];
                    sprintf(entry, "%s:%d,", sym, quant);
                    strcat(updated_stocks, entry);
                }
                token = strtok(NULL, ",");
            }
            if (!stock_found) {
                printf("You do not own this stock.\n");
                fclose(pf);
                return;
            }
            int len = strlen(updated_stocks);
            if (len > 0 && updated_stocks[len - 1] == ',') updated_stocks[len - 1] = '\0';
            // If no stocks left, set to "None"
            if (strlen(updated_stocks) == 0) {
                strcpy(temp_port.stocks, "None");
            } else {
                strcpy(temp_port.stocks, updated_stocks);
            }
            sale_amount = quantity * stock[stock_index].price;
            temp_port.balance += sale_amount;
            temp_port_struct[port_count++] = temp_port;
            break; // Exit the loop after processing the sale for the user
        } else {
            temp_port_struct[port_count++] = temp_port;
        }
    }
    fclose(pf);
    int new_balance = 0;
    for (int i = 0; i < port_count; i++) {
        if (strcmp(temp_port_struct[i].username, username) == 0) {
            new_balance = temp_port_struct[i].balance;
            break;
        }
    }

    pf = fopen("portfolio.txt", "w");
    for (int i = 0; i < port_count; i++) {
        fprintf(pf, "%s %d %s\n", temp_port_struct[i].username, temp_port_struct[i].balance, temp_port_struct[i].stocks);
    }
    fclose(pf);

    FILE* uf = fopen("users.txt", "r");

    if (uf == NULL) {
        printf("Error opening users file.\n");
        return;
    }
    while (fscanf(uf, "%s %s %s %d", temp_user.username, temp_user.fullname, temp_user.password, &temp_user.balance) != EOF) {
        if (strcmp(temp_user.username, username) == 0) {
            temp_user.balance = new_balance; // sync balance
            *current_user = temp_user;
        }
        users[user_count++] = temp_user;
    }
    fclose(uf);
    uf = fopen("users.txt", "w");
    for (int i = 0; i < user_count; i++) {
        fprintf(uf, "%s %s %s %d\n", users[i].username, users[i].fullname, users[i].password, users[i].balance);
    }
    fclose(uf);
}

void fix_empty_portfolios() {
    FILE* pf = fopen("portfolio.txt", "r");
    portfolio temp_port;
    portfolio temp_port_struct[100];
    int port_count = 0;
    if (pf == NULL) {
        printf("Error opening portfolio file.\n");
        return;
    }
    while (fscanf(pf, "%s %d %[^\n]", temp_port.username, &temp_port.balance, temp_port.stocks) != EOF) {
        if (strlen(temp_port.stocks) == 0 || temp_port.stocks[0] == '\n' || temp_port.stocks[0] == '\0') {
            strcpy(temp_port.stocks, "None");
        }
        temp_port_struct[port_count++] = temp_port;
    }
    fclose(pf);
    pf = fopen("portfolio.txt", "w");
    for (int i = 0; i < port_count; i++) {
        fprintf(pf, "%s %d %s\n", temp_port_struct[i].username, temp_port_struct[i].balance, temp_port_struct[i].stocks);
    }
    fclose(pf);
}
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_DAYS 100
#define MAX_LINE 100
#define MAX_DATE_LEN 20
#define MAX_PRICES_PER_DAY 100

typedef struct {
    char date[MAX_DATE_LEN];
    int day_only;
    float prices[MAX_PRICES_PER_DAY];
    int price_count;
    float min_price;
    float max_price;
} DayTrend;

void show_stock_trend(const char *stock_name) {
    char filename[100];
    snprintf(filename, sizeof(filename), "stock_trend_of_%s.txt", stock_name);
    FILE *file = fopen(filename, "r");
    if (!file) {
        printf("Error: Could not open file %s\n", filename);
        return;
    }

    DayTrend trends[MAX_DAYS];
    int day_count = 0;
    char line[MAX_LINE];

    // Read and group prices by date
    while (fgets(line, sizeof(line), file)) {
        float price;
        char date[MAX_DATE_LEN];
        if (sscanf(line, "%f %s", &price, date) != 2) continue;

        int found = 0;
        for (int i = 0; i < day_count; i++) {
            if (strcmp(trends[i].date, date) == 0) {
                trends[i].prices[trends[i].price_count++] = price;
                found = 1;
                break;
            }
        }

        if (!found) {
            strcpy(trends[day_count].date, date);
            int day;
            sscanf(date, "%d-%*d-%*d", &day); 
            trends[day_count].day_only = day;
            trends[day_count].prices[0] = price;
            trends[day_count].price_count = 1;
            day_count++;
        }
    }
    fclose(file);

    if (day_count == 0) {
        printf("No trend data found.\n");
        return;
    }

    float global_min = 999999, global_max = -1;

    // Compute min and max per day
    for (int i = 0; i < day_count; i++) {
        float min_p = trends[i].prices[0];
        float max_p = trends[i].prices[0];
        for (int j = 1; j < trends[i].price_count; j++) {
            if (trends[i].prices[j] < min_p) min_p = trends[i].prices[j];
            if (trends[i].prices[j] > max_p) max_p = trends[i].prices[j];
        }
        trends[i].min_price = min_p;
        trends[i].max_price = max_p;

        if (min_p < global_min) global_min = min_p;
        if (max_p > global_max) global_max = max_p;
    }

    // Round to nearest 100
    int ymin = ((int)global_min / 100) * 100;
    int ymax = ((int)global_max / 100 + 1) * 100;

    // Print chart
    printf("\nStock Trend for: %s\n\n", stock_name);
    for (int y = ymax; y >= ymin; y -= 100) {
        printf("%5d | ", y);
        for (int i = 0; i < day_count; i++) {
            if ((int)trends[i].min_price <= y && (int)trends[i].max_price >= y)
                printf("|  ");  
            else
                printf("   ");  
        }
        printf("\n");
    }

    // X-axis line
    printf("       ");
    for (int i = 0; i < day_count; i++) printf("---");  
    printf("\n");

    // Print days with 2 spaces spacing
    printf("       ");
    for (int i = 0; i < day_count; i++) {
        printf("%2d  ", trends[i].day_only);
    }
    printf("\n");
}